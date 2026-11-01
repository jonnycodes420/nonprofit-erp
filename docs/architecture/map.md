# The map of Steward's code (MAP-1)

Read-only survey of `main` at `37a702b` (2026-10-31). Nothing in the code was changed.
The recommendations that follow from it are in [`recommendations.md`](recommendations.md).

**How the counts were made.** Line counts are `wc -l` over files tracked by git (blank lines and
comments included). "Code" means `.js .jsx .mjs .cjs .ts .css .sql .sh .html`. Lock files and
images are left out. The import graph resolves every relative `require()`, `import … from` and
`import()` across the 1,076 tracked JS files. The scripts that did the counting were kept outside
the repo. Their method is described in each section so that anyone can re-run it.

---

## 1. The shape

### Top-level folders

| Folder | Code lines | Code files | All text lines | What lives there |
|---|---:|---:|---:|---|
| `client/` | 96,400 | 293 | 97,246 | React 18 + Vite app: `src/components` (the CRM screens), `src/pages` (public pages: Donate, Portal, Giving dashboard, admin), `src/marketing` (the public site), `src/lib` |
| `routes/` | 74,807 | 51 | 74,807 | Express routers. `crm.js` alone is 30,229 lines with 561 routes |
| `tests/` | 56,922 | 245 | 158,568 | Suites, `tests/lib` harness, plus 84,713 lines of JSON and 16,563 of CSV fixtures (the real-shaped files) |
| (root `*.js`) | 51,472 | 123 | 55,390 | `server.js`, `db.js` and about 120 single-purpose backend modules (`afterChange`, `figureSources`, `donorStatus`, `insights`, `qboSync` …) |
| `shared/` | 38,174 | 139 | 38,177 | Pure modules shared by server and client: import parsing, shapes, form config, help content |
| `scripts/` | 34,574 | 221 | 36,378 | Seed, ops, CI helpers, guards and many one-off build probes (see §3) |
| `docs/` | 6,940 | 37 | 88,234 | Decisions, HISTORY, changelog, help articles, design mock-ups (HTML) |
| `audit/` | 0 | 0 | 49,440 | Generated JSON (`route-inventory.json`, `suite-timings.json`) and old build findings |
| `support/` | 578 | 2 | 4,660 | Help-index builder |
| `sources/` | 1,529 | 7 | 1,529 | Giving-source adapters (Square, Zeffy, Givebutter, Stripe), loaded by `readdir` |
| `claude/` | — | — | 1,271 | Prompt/notes files |
| `zapier/` | 891 | 12 | 988 | Zapier app |
| `middleware/` | 916 | 5 | 916 | `auditTrail.js` and friends |
| `.github/` | — | — | 847 | CI, nightly AI, ZAP baseline workflows |
| `legal/`, `.githooks/`, `assets/`, `migrations/` | 39 | 1 | 418 | DPA text, pre-push hook, one SQL file |
| **Total** | **363,242** | **1,136** | **608,870** | 4,509 tracked files in all |

(The 343k measured earlier today was taken from an older main checkout and counted fewer extensions. 363k is the count for this commit.)

### The 40 largest non-test files

"Imported by" counts the tracked files that `require`/`import` it, with tests in brackets.

| # | File | Lines | What it does | Imported by |
|---:|---|---:|---|---:|
| 1 | `routes/crm.js` | 30,229 | The CRM API: donors, gifts, events, grants, campaigns, journeys, tasks, imports, reports. 561 routes | 5 (0) |
| 2 | `server.js` | 12,735 | Boot, middleware, `recordGift`, and every background job (see below) | 14 (13) |
| 3 | `db.js` | 9,718 | Pool and query helpers, the whole schema as inline DDL, boot seed | 71 (5) |
| 4 | `routes/give.js` | 8,131 | Giving pages, forms, donor portal, donor accounts, recurring gifts, giving sources. 167 routes | 2 (0) |
| 5 | `routes/finance.js` | 4,878 | Ledger, funds, payouts, QBO/Xero, calendar and mailbox OAuth. 93 routes | 3 (0) |
| 6 | `client/src/components/Settings.jsx` | 4,583 | Every Settings section: giving pages, branding, receipts, rates, imports page, trash | 3 (0) |
| 7 | `shared/importShape.js` | 4,575 | Header/cell normalisers, shape detection and the column classifier for imports | 30 (8) |
| 8 | `client/src/components/DonorImport.jsx` | 4,559 | The import wizard: field registry, auto-mapper, payload builders, chunked submit | 3 (0) |
| 9 | `scripts/seed-demo.js` | 4,191 | Writes the Harborlight demo org (`org_b72demo`) | 2 (1) |
| 10 | `client/src/components/DonorProfile.jsx` | 4,112 | The donor profile with its modals, photo control, header chips and right rail | 1 (0) |
| 11 | `routes/agent.js` | 3,401 | Agent, AI helpers, workflows, sequences, help tickets. 57 routes | 3 (0) |
| 12 | `client/src/components/Dashboard.jsx` | 3,384 | Home | 1 (0) |
| 13 | `figureSources.js` | 3,300 | Every `<Figure>` source: the SQL behind each clickable number, footing to the cent | 21 (5) |
| 14 | `routes/billing.js` | 3,243 | Sign-in, platform billing, super-admin, health. 68 routes | 1 (0) |
| 15 | `routes/webhooks.js` | 3,070 | Stripe, Resend, Mailchimp, PayPal, inbound-email webhooks; unsubscribe | 1 (0) |
| 16 | `routes/volunteerScheduling.js` | 2,539 | Volunteer hub: shifts, sign-ups, reminders, waivers. 59 routes | 1 (0) |
| 17 | `client/src/components/Communications.jsx` | 2,438 | Campaigns, segments, sequences builder | 1 (0) |
| 18 | `client/src/pages/Donate.jsx` | 2,043 | Public giving page, tickets, membership, peer-to-peer pages | 3 (0) |
| 19 | `client/src/components/Finance.jsx` | 2,008 | Finance tab: money in, payouts, monthly close, budget | 1 (0) |
| 20 | `client/src/pages/AdminDashboard.jsx` | 2,007 | Super-admin console | 1 (0) |
| 21 | `client/src/components/Events.jsx` | 1,999 | Events, seating chart, check-in | 2 (0) |
| 22 | `client/src/components/shared.jsx` | 1,917 | Brand tokens `T` and shared UI primitives | 156 (0) |
| 23 | `shared/sheetRead.js` | 1,906 | IMPORT-3 reader for any spreadsheet shape | 18 (12) |
| 24 | `client/src/components/Fundraising.jsx` | 1,550 | Campaigns and funds hub | 1 (0) |
| 25 | `client/src/components/VolunteersHub.jsx` | 1,507 | Volunteers tab | 1 (0) |
| 26 | `client/src/pages/PortalEditor.jsx` | 1,449 | In-place editor for the donor portal | 1 (0) |
| 27 | `client/src/components/JourneyBuilder.jsx` | 1,427 | Journey timeline builder | 2 (0) |
| 28 | `routes/dataHealth.js` | 1,345 | Data health: kinds of mess, counts, fix proposals | 5 (1) |
| 29 | `client/src/components/Connections.jsx` | 1,250 | "Is the money still arriving?": giving-source status | 1 (0) |
| 30 | `shared/agentShape.js` | 1,232 | What the agent may be told to do, and the shape of its plans | 6 (2) |
| 31 | `client/src/components/DonorDirectory.jsx` | 1,199 | Donor list, re-engage, team view, filters | 1 (0) |
| 32 | `routes/sheetImport.js` | 1,198 | IMPORT-3 write path for any spreadsheet (through `recordGift`) | 1 (0) |
| 33 | `client/src/App.jsx` | 1,182 | App shell, rail and tab routing | 1 (0) |
| 34 | `client/src/pages/GivingDashboard.jsx` | 1,173 | Cross-org donor dashboard (consumer surface) | 1 (0) |
| 35 | `routes/why.js` | 1,171 | WHY-1 "ask why" endpoint | 2 (0) |
| 36 | `insights.js` | 1,126 | Pure INSIGHTS-1 engine: who to call, why, what to say | 6 (2) |
| 37 | `shared/helpArticles.js` | 1,074 | Help content, one article per screen | 6 (2) |
| 38 | `routes/volunteer.js` | 1,041 | Volunteers, shifts, hours | 1 (0) |
| 39 | `client/src/components/MajorGifts.jsx` | 1,039 | Moves management and portfolios | 2 (0) |
| 40 | `routes/auctions.js` | 1,010 | Auctions | 1 (0) |

### Files over 2,000 lines: their jobs, and which jobs could be their own file

**`routes/crm.js` (30,229 lines, 561 routes).** Routes by first path segment: `/donors` 78, `/org` 43,
`/events` 34, `/grants` 28, `/campaigns` 21, `/me` 20, `/journeys` 20, `/tasks` 16, `/dashboard` 11,
`/acknowledgments` 10, `/imports` 9, `/gifts` 9, then 85 more prefixes with 1 to 8 routes each (threads,
saved reports, milestone drafts, custom fields, pledges, programs, pipeline, memberships,
interactions, board pack, households, funders, receipts, deposits, goals …).
Each of these could be its own file:
- **events** (34 routes) → `routes/events.js`
- **grants + funders + grant-documents/outlines** (~36) → `routes/grants.js`
- **campaigns + journeys + journey-sends + acknowledgments + thank-yous** (~59) → `routes/outreach.js`
- **imports** (`/donors/import*`, `/imports*`, `/import-merges`, `/gifts/import-history`, ~15 routes, roughly lines 5,171–10,300) → `routes/imports.js`
- **tasks, threads, nudges, note reminders** → `routes/tasks.js`
- **dashboard, saved-reports, saved-dashboards, reports, board-pack, figures** → `routes/reports.js`
- **pipeline, portfolio, moves, proposals, opportunities, major-gifts** → `routes/majorGifts.js`
- **memberships + levels** → `routes/memberships.js`
- **org + me + settings + users + api-keys + custom-fields** → `routes/org.js`
- what remains is `/donors` + `/gifts` + `/pledges` + `/households` + `/interactions`, the person record

**`server.js` (12,735 lines).** See the jobs list below. The background jobs (lines ~1,180–12,540)
are the separable part: around 200 `async function`s, of which only `recordGift`, auth and org-scope
helpers need to stay at the core.

**`db.js` (9,718 lines).** The pool and query helpers take lines 1–305. `runSchemaInit` runs from
line 306 to 8,928: about 8,600 lines of inline DDL with 276 `CREATE TABLE`, 817 `ALTER TABLE`, 355
`CREATE INDEX` and 12 functions/triggers. Backfills follow (`backfillLinkedTasks`,
`householdsFromLinks`, `keepEarlierTotals`), then `seedData` and `seedOrgData` (~700 lines of
boot-seed fixture). The DDL could live in its own `schema/` file or in ordered migration files. The
seed could be its own file.

**`routes/give.js` (8,131, 167 routes).** `/account` 23, `/giving-pages` 21, `/recurring` 19,
`/giving-sources` 15, `/portal` 14 (+ portal-page/settings/assets/audit 9), `/pos` 6, `/org-form` 6,
`/gift-starts` 6, peer fundraisers/p2p 6, network/connections 9. Natural files: **portal + donor
accounts**, **giving pages + forms**, **recurring**, **giving sources + POS**.

**`routes/finance.js` (4,878, 93 routes).** `/finance` 26 and `/bookkeeping` 5 are finance.
`/qbo` 16, `/xero` 6 and `/oauth` 6 are accounting sync. `/calendar` 14, `/mailbox` 6, `/email-marketing` 7
and `/meetings` 1 are **calendar and mailbox, which don't belong in finance at all**. They could move
to `routes/calendarMail.js`, and `qbo`/`xero` to `routes/accounting.js`.

**`client/src/components/Settings.jsx` (4,583).** It holds about 30 separate cards: GivingPagesManager (417 lines),
BrandingManager, TimezoneCard, BoardPackRecipientsCard, ProcessingRatesCard, MatchingEmployersCard,
CoverFeesCard, GivingLevelsCard, TaxReceiptsManager, PortalWebsiteSnippet, ImpactUpdatesManager, the
Imports page (AddPhotos, BringInAFile, ImportsDrop, EmptyTrash, SavedMappings, ImportsHistory …).
Each card is self-contained and could be its own file under `components/settings/`. The imports page
is the biggest candidate.

**`shared/importShape.js` (4,575).** It has five jobs: header tokens and labels; cell normalisers
(date, money, email, names); flag columns and wealth screen; encoding repair; and the report-export
layer (CSV records, header-row detection, row classification, column type evidence). Encoding and
CSV parsing could form one file, and cell normalisers another.

**`client/src/components/DonorImport.jsx` (4,559).** It holds the field registry and labels, the
auto-mapper, row builders (donor, combined), shape-aware payload builders (aggregate, transaction,
wide), the chunked submitter, the "import both" builder, then the wizard UI. Everything above the UI
is pure logic and could move to `lib/importPayload.js`.

**`scripts/seed-demo.js` (4,191).** `main()` is one function of ~3,570 lines (lines 278–3,845),
followed by addresses, card updates, gift starts, `writeAll`, real-person removal and teardown. The
seed could be split by section (people, gifts, events, grants …).

**`client/src/components/DonorProfile.jsx` (4,112).** FollowUpTaskModal, LogTouchpointModal (208),
EditDonorModal, GiftLinkModal (122), PhotoAdjuster (122), DonorPhotoControl, HeaderChips, RoleLine,
RailGroups, then `DonorProfile` itself from line 1,054 (~3,050 lines). The modals and the photo
control could be their own files. The rail must stay (standing rule).

**`routes/agent.js` (3,401).** `/sequences` 22, `/agent` 20, `/workflows` 5, `/help` 4, `/ai` 3. The
sequences routes belong with journeys and campaigns rather than with the agent.

**`client/src/components/Dashboard.jsx` (3,384).** `Dashboard` is one component from line 212 to the
end (~3,170 lines). It is the most-collided client file (§5). Its sections (pins, impact line, the
thread, drift, tasks) could be child components.

**`figureSources.js` (3,300).** It has parameters, shared SQL fragments (`giftsWhere`, `pledgesDueSql`,
`topGiversSql`), then the `SOURCES` table by family: gifts, givers, bunt (~190), members,
unthanked, conversations, milestones (~260), meetings (~150), **why (~570)**, **recurring (~530)**,
**grant (~280)**, query, ask (~210), retention, then helpers and the engine. Each family could be a
file in `figureSources/`.

**`routes/billing.js` (3,243).** `/admin` 39 routes (the super-admin console), `/billing` 12, `/auth`
9, `/public` 6. Super-admin could be `routes/admin.js`.

**`routes/webhooks.js` (3,070).** The Stripe donation webhook is the bulk. Mailchimp, PayPal, Resend
and inbound email are small. Stripe could be its own file.

**`routes/volunteerScheduling.js` (2,539).** `/volunteer-hub` 47 routes. It overlaps with
`routes/volunteer.js` (1,041). Two volunteer route files exist.

**`client/src/components/Communications.jsx` (2,438).** CampaignBriefing, SegmentPicker, SeqStep,
the sequences panel and the campaign editor. The sequences panel could be its own file.

**`client/src/pages/Donate.jsx` (2,043).** StartFundraiserModal, TicketsPage, MembershipPage,
DonorSignIn, P2PBoard, TeamPage, then `Donate`. The tickets, membership and P2P pages are separate
pages that share a file.

**`client/src/components/Finance.jsx` (2,008).** FundModal, TransactionModal (240), MoneyInStrip,
PayoutsView, MonthlyClose (180), then `Finance` (760) and BudgetInput.

**`client/src/pages/AdminDashboard.jsx` (2,007).** Overview, OrgPanel (415), Organizations,
Metrics: four pages in one file.

### Every job `server.js` does

1. **Boot.** Env, Sentry, the process role (`web` / `worker`, `STEWARD_PROCESS`), `app.listen`, `JQ.start` (job queue scheduler), the 15-second refresh interval, `scheduleBillingModeCheck`.
2. **Middleware.** 93 `app.use` calls: CORS, compression, rate limits, auth, the audit trail and the 54 route-module mounts.
3. **Its own routes (12).** `/health`, `/ready`, `/status/summary`, `/admin/status`, `/admin/number-checks` (+run), `/admin/incidents`, `/admin/changelog`, `/changelog/hidden`, `/legal/dpa(.pdf)`.
4. **Org time.** `orgTz`, `orgTzName`, `orgLeadDays`.
5. **The one gift path.** `recordGift` (line 1,202, ~430 lines), `checkGiftExtras`, `writeGiftExtras`, `findCrossSourceGift`, `queueThankYouDraft`.
6. **Ledger and funds.** `ensureOrgLedger`, `orgUnrestrictedFundId`, `refreshReconcileDenominator`, `reconcileStripeVsGifts`.
7. **Scores, status and drift.** `recomputeScoresForOrg`, `recomputeAllScores`, `scheduleScores`, `refreshStoredDrift`, `recalcDonorSummary`, `autoLapseOrg`, `unlapseHeldByPledge`, `recordMove`, `recordAutoMove`, `computeDriftForDonors`, `driftGiftAnswers`.
8. **Giving sources.** `syncSource`, `writeSourceRow`, `resolveSourceDonor`, `recordSourceRun`, `processGivingSources`, `sweepQuietConnections`, `ingestPosSale`.
9. **Recurring and Stripe.** `refreshRecurringForDonors`, `sweepMissedRecurring`, `openMissedRecurringThread`, `processDunning`, `refreshCardsOnFile`, `notifyExpiringCards`, `logRecoveryEvent`, `computeRecoveryRate`, `checkWebhookSubscriptions`, `stripeChargesEnabled`.
10. **Pledges.** `processPledgeInstallmentReminders`, `onPledgeSettled`, `recalcPledgePayment`, `processPledgeReminders`.
11. **Receipts.** `allocateReceiptNumber`, `renderReceiptPdf`, `issueGiftReceipt`, `resolvePdfLogo`.
12. **Grants.** `raiseGrantMilestone`, `processGrantMilestones`, `grantMoneyRows`.
13. **Volunteers.** `markVolunteer`, `makeVolunteer`, `insertShift`, `volunteerSummary`, `runVolunteerRemindersTick`.
14. **Threads and tasks.** `openThreadTx`, `openGiftThread`, `openAdminTask`, `openCareThread`, `openSustainerLapseThread`, `computeThreadHealth`, thread nudges, step reminders, `notifyTaskAssignment`.
15. **Mail identity and gates.** `orgSendingIdentity`, `donorSendOpts`, `donorFacingOrgName`, `bulkSendAddressGate`, `resolveOrgBrandTheme`, `sendStaffWrittenEmail`, `notifyUserOnce`, `retryFailedNotifications`, `sendDonorLifecycleEmail`.
16. **Campaigns, segments and sequences.** `resolveSegmentSpec`, `resolveCampaignRecipients`, `runCampaignSend`, `processSequences`, `enrollInSequences`, `autoEnroll`, `processTrackedSequences`, at-risk and milestone candidates and their AI drafts.
17. **Digests and morning mail.** `runDigestsForOrg`, `composeWeekInReview`, `composeOfficerMonthly`, `composeActivityReport`, `runMorningBriefForOrg`, `runMeetingBriefForOrg`, `runDailyTaskRemindersForOrg`, saved-report schedules.
18. **Workflows.** `ensureWorkflows`, `runWorkflowAction`, `fireWorkflows`, `processWorkflowSweeps`, `provisionNewOrgWorkflows`.
19. **Billing and plan limits.** `checkWriteAccess`, `checkBillingPriceModes`, `countRecords`, record bands, `processTrialReminders`, `checkPlanLimit`, `agentTrialAllowance`.
20. **Mailbox and calendar sync.** `syncMailbox*`, `syncCalendar*`, `pushStewardDates`, Gmail/Graph delta walks, `fetchMailboxMessages`, `processUnansweredMail`, `inboundMod`.
21. **Outbound webhooks.** `emitWebhook`, `deliverWebhooks`, `openWebhookThread`.
22. **Events, memberships and auctions.** `registerForEvent`, `sendEventTicketEmail`, `enrollMembership`, `renewMembership`, `processMembershipRenewals`, `processAuctionUnpaid`, `storeAuctionPhoto`.
23. **Portal and giving-page theming and uploads.** `giveThemePayload`, `portalTimeline`, image validation and normalisation, `resolveWidgetsPublic`, `coverFeePayload`, `smartAmountsFor`.
24. **Queues.** `processGeocodeQueue`, `processPhotoQueue`.
25. **Ops.** `statusCheckOnce`, `recordTick`, `opsAlert`, `refreshNotifyFailedCount`, `snapshotMetricsForOrg`.
26. **Org metrics.** `computeStewardshipDebt*`, `computeFirstTouchDelay`, `computeRetentionRate` (this is a second retention computation; see §2).
27. **Auth helpers.** `signInternalToken`, `mfaVerifyForUser`, `requireCrm`, `orgOwns`, `writeAuditLog`.
28. **Exports.** Its `module.exports` is a context object for the route modules. That is why 13 tests import it.

### Every job `db.js` does

1. **Connection.** `getDb`, `setPool`, `setPoolReady`, `target`.
2. **Queries.** `query`, `run`, `querySetwise`, `queryOutside`, `runOutside`, the `?`→`$n` placeholder rewrite.
3. **Transactions and locks.** `withClient`, `withTransaction`, `withAmbientTransaction`, `queryTx`/`runTx`, `withAdvisoryLock`, `withTryAdvisoryLock`.
4. **Instrumentation.** `countRoundTrips`, `noteTrip`.
5. **Schema.** `schemaUnchanged` (skip when unchanged), `ddlSession`, `initSchema`, and `runSchemaInit`: 8,600 lines of inline DDL.
6. **Backfills on boot.** `backfillLinkedTasks`, `householdsFromLinks`, `keepEarlierTotals`.
7. **Boot seed.** `seedData` (the `org_creo` fixture org) and `seedOrgData`.
8. **IDs.** `uuid`.

---

## 2. One number, how many places

Read-only map of worktree `steward-map1` (main at 37a702b). Line numbers are from that tree. "By construction" means the place calls the shared function, figure source or stored rollup; "by luck" means it re-wrote the math and agrees only while the data stays simple. A place that only *reads* a stored column (`donors.total_giving`, `donors.last_gift_date`) is counted under the code that writes the column, not as its own place, unless it adds its own rule on top.

**The truth check.** `assertSurfacesAgree` (`tests/lib/surfacesAgree.js`) asks surfaces over HTTP and compares them to its own SQL. Its ground truth is written inline in the test, not read from any app function: "people are `donors` rows with no `deleted_at` and not sample rows, money is their gifts" (lines 9-11, 131-136). Three facts about that ground truth matter for every money number below:

- It sums `gifts.amount` with **no** credit-type filter, so soft or matching credit rows count as money (`creditTypes.js` says they never do).
- Refunds (negative rows) come off, undated gifts count in all-time totals, and a gift row's own `is_sample` is not checked (only the donor's).
- Several checks compare surface to surface only, with no database value at all: lapsed, came-and-didn't-give, gave, and the units/fee checks.

Two common rules for reading the tables: **refunds** are negative `gifts` rows; **credits** are rows whose `type` is in `creditTypes.CREDIT_TYPES`; an **imported total** is `donors.imported_*` (NUMBERS-2), which only `donorSummary.js` and the `donor-lifetime` source add in.

### 1. Lifetime giving

**Shared definitions (2):** `donorSummary.js:44-80` `DONOR_SUMMARY_UPDATE` writes the stored rollup `donors.total_giving` (imported total + gifts after `imported_through`, refunds off, credits out). `figureSources.js:900-929` `donor-lifetime` recomputes the same thing live from `gifts` (same rules). Callers of the rollup: `afterChange.js:57`, `server.js:1361`, `server.js:3598`, `routes/crm.js:5168`, `routes/dataHealth.js:748,920`, `sampleData.js:262`, `db.js:9656`. Callers of the source: `creditTotals.js:15`, `numbers.js:50`, `routes/crm.js:4581,4776`, `routes/prospect.js:47`, `routes/why.js:484`. About 40 more places read `d.total_giving` directly (Donors list `donorList.js:91`, `shared/reportBuilder.js:42`, `figureSources.js:588` top-lifetime, `:605` household-giving, `askQuery.js:42`, `routes/agent.js:1248`, and others): by construction.

**Places that compute it themselves: 13.**

| Place | How | Verdict and differences |
|---|---|---|
| `donorSummary.js:44` | stored rollup | **shared** (by construction) |
| `figureSources.js:900` `donor-lifetime` | live from gifts | **shared**; matches the rollup by design |
| `insights.js:335,351` | `lifetime: sum(gs)` per giving unit | **by luck.** Only `amount_cents > 0`, so refunds are **not** taken off; leaves out imported totals; adds up a whole **household** as one unit; leaves out rows marked Not a gift. Feeds Home's Insights cards, `routes/insights.js:121` and the major line. |
| `why.js:686,707` (`person`) | `gifts.reduce` over `amount > 0` | **by luck.** Refunds ignored, credit rows counted, no imported total. Feeds Ask why's "$X across N gifts" sentence (`shared/whyShape.js:139`). |
| `engagement.js:194,206` generosity `lifetime` part | `sum(gifts)` | **by luck.** Refunds off, but credit rows counted, no imported total, undated gifts dropped (`engagement.js:179`). Score input, and its drawer (`donor-generosity-part`) says "net of refunds". |
| `routes/give.js:6153` (`/portal/:orgSlug/me`) | own `SUM(amount)` | **by luck, donor-facing.** Credit rows counted, no imported total, no deleted filter. |
| `routes/give.js:7767` (`/account/dashboard`) | own `SUM(amount)` per org | **by luck, donor-facing.** Same as above, across orgs. |
| `routes/templates.js:105` `factsFor` | own `SUM(amount)` → merge field `lifetime_total` | **by luck, donor-facing.** Credit rows counted, no imported total. |
| `prospectBrief.js:24` | own `SUM(amount) WHERE amount > 0` | **by luck.** Refunds ignored, credit rows counted. |
| `routes/crm.js:15838-15860` (`/donors/:id/fund-affinity`) | reads `total_giving`, then re-sums by fund and unrestricted | **by luck.** The fund split includes credit rows, so the parts need not add up to the stored total. |
| `client/src/components/DonorProfile.jsx:2784` | client `giftsFull.reduce` = Gift History "Total" | **by luck.** It is the sum of whatever rows the tab lists. It differs from the header's Lifetime whenever there is an imported total, and if the list carries credit rows. |
| `routes/crm.js:24513-24536` (Top donors, lifetime) | rows from `total_giving`; "all time" figure is the `gifts` source from 1900-01-01 to today | by construction for the rows. The all-time figure leaves out **undated and future-dated** gifts. |
| `routes/crm.js:22062` (Fundraising `allTime`) | own `SUM(g.amount)`, live donors | **by luck.** It includes undated and credit rows, so it matches the truth check. It **differs** from Reports' all-time figure (undated) and from the sum of the Donors list's lifetime (credits and imported totals). |
| `db.js:8995` | migration back-fills `imported_total = total_giving − gifts` | one-time; outside the runtime |

**Truth check:** "total given" (lines 268-275) is its own SQL (credits and undated included, refunds off) against Fundraising all-time, the workbook, the sum of the Donors list's `total_giving`, and the CSV. The list and CSV legs are skipped whenever anyone has an imported total. **Visible gap:** any org with a soft or matching credit row fails the list leg, because `total_giving` leaves credits out and the truth includes them. Nothing checks `insights.js`, `why.js`, the portal, merge fields or the engagement part.

### 2. This fiscal year's giving

**Shared definitions:** the year boundary is `orgTime.orgPeriodBounds(org,"fiscal_year")` (`orgTime.js:233-245`), wrapped by `orgFiscalYearStart` (`orgTime.js:253`). The money is the `gifts` figure source (`figureSources.js:496`).

**Places: 14 (4 by construction, 10 by luck).**

| Place | How | Verdict and differences |
|---|---|---|
| `routes/crm.js:1968,2001` Board `revenueThisYear` | `orgPeriodBounds` + `gifts` source, start to today | **by construction.** This is the truth check's reference. |
| `numbers.js:174` `vsLastYear` / `lastYearSpan` | `gifts` source on both halves | **by construction** (Home, the Board, Fundraising's compare) |
| `routes/crm.js:4590` profile "This year" | `donor-gifts-between` from `orgFiscalYearStart` | **by construction.** It is per person, with credits **left out**, while the org-level `gifts` source counts them. |
| `routes/profileStatus.js:57`, `routes/finance.js:1614` | `donor-gifts-between` from `donorStatus.windowsFor(...).cyFrom` | by construction of the source. The year start comes from a **second** fiscal computation (`donorStatus.js:97-103`, which falls back to month 1 if `cuts` is missing; the callers pass `cutsFor`, so they get the org's month). |
| `server.js:5728` `finPeriodBounds` | **its own fiscal-year arithmetic** | **by luck.** A third copy of the boundary. It agrees with `orgPeriodBounds` today. |
| `routes/crm.js:22039` Fundraising Raised tile | own `SUM(g.amount)` over `finPeriodBounds` start to **end** | **by luck.** It runs to the end of the fiscal year, not today, so **future-dated gifts count**; the Board stops at today. The truth check compares them. |
| `server.js:12231` `computeRetentionRate` `fyOf` | its own fiscal-year arithmetic | **by luck** (a fourth copy of the boundary) |
| `routes/crm.js:19345` and `19582-19600` (`/dashboard/my-stats`, gifts breakdown) | own SQL, `g.date >= fyStart` | **by luck.** No upper bound, so future-dated gifts count. Credits are included. |
| `askEngine.js:60-74` Ask "raised" | own gift-set SQL over the catalog's span | **by luck** (in the truth check through `/ask`) |
| `afterChange.js:113-117` `donor_rhythm.giving_this_year` | JS, **calendar** year, `amount > 0` | **by luck, stored and never read** (only `afterChange.js` touches the column) |
| `why.js:734-737` | JS, **calendar** year to today | **by luck.** Ask why's "this year against last". |
| `routes/give.js:7768` donor account `ytd` | `LEFT(date,4) = nowYear`, **calendar** year | **by luck, donor-facing** |
| `routes/templates.js:106` merge field `year_total` | **calendar** year | **by luck, donor-facing** |
| `routes/crm.js:22808` `/annual-fund` | JS, **calendar** year | by luck. It is labelled the annual fund, so a calendar year may be intended. |
| `routes/crm.js:23774,23835` `POST /reports/board` (AI board report) | `ytdS = ${yr}-01-01`, **calendar** year, no deleted filter | **by luck.** It disagrees with the Board dashboard for any org whose year does not start in January. |

**Truth check:** "giving this year so far" (lines 279-299): its own SQL from `board.fiscalYear.start` to today (credits included, live donors) against the Board, Fundraising's Raised tile (fiscal mode only), Atlas and Ask. It does **not** check `my-stats`, the AI board report, the donor portal or merge fields.

### 3. Last gift (date and amount)

**Shared definitions (2), which disagree with each other by design:**
- `donorSummary.js:66-71` stored `last_gift_date` and `last_gift_amount` = `MAX(g.date)` over **all** rows, **including refunds and credit rows**, with the imported last gift as a floor. `figureSources.js:986` `donor-last-gift` = the same rule live (`date IS NOT NULL`, no amount filter).
- `donorStatus.js:151` `last_date` = `MAX` over gifts **with `amount > 0`**, plus the imported last gift. `lapseRule.lapseState` says its input is "their latest gift above zero".

So a refund dated after the last real gift moves the stored `last_gift_date` (and makes `last_gift_amount` negative) but not the tag's `last_date`.

**Places: 14.**

| Place | How | Verdict |
|---|---|---|
| `donorSummary.js:66` | rollup | **shared** (refunds and credits count) |
| `figureSources.js:986` `donor-last-gift` | live | **shared**; same rule as the rollup |
| `donorStatus.js:151` `statusSql` | `MAX ... FILTER (amount > 0)` + imported | **shared for the tags**; differs from the rollup on refunds and credits |
| `insights.js:314-315,353` `x.last` / `lastDated` | JS, `amount_cents > 0`, credits out, no imported last gift | **by luck** |
| `why.js:686,706` | first row of `amount > 0`, `ORDER BY date DESC` | **by luck.** No imported last gift. |
| `routes/why.js:785,817,1144` | `MAX(g.date) WHERE amount > 0` subqueries | **by luck.** No imported last gift. |
| `routes/crm.js:26879-26887` (`/impact` re-engage list) | `MAX(g.date) WHERE amount > 0` | **by luck** (see also #4) |
| `shared/lostAndFound.js:170` `lastPositive` | JS, `cents > 0` | **by luck.** It runs in the browser. |
| `routes/emailTemplates.js:500-503` `donorFields` and `:196-206` | `ORDER BY date DESC LIMIT 1`, no tiebreak, no amount filter | **by luck, donor-facing.** A refund or credit row can be "last gift", and two gifts on one day pick at random. |
| `routes/give.js:7769` donor account `last_gift` | `MAX(date)`, all rows | **by luck, donor-facing** |
| `routes/templates.js:101-103` `factsFor` last gift | `amount > 0 ORDER BY date DESC, id DESC` | **by luck, donor-facing.** Its tiebreak (`id DESC`) differs from `LAST_GIFT_ORDER` (`created_at DESC, id DESC`). |
| `prospectBrief.js:24` | `MAX(LEFT(date,10)) WHERE amount > 0` | **by luck** |
| `setup.js:509` | `MAX(g.date)` all rows | **by luck** (an onboarding call list) |
| `client/src/components/DonorImport.jsx:481` | client reduce over the file's gifts | **by luck** (an import preview) |

**Truth check:** **not covered.** No assertion compares a last-gift date or amount between surfaces.

### 4. Lapsed / lapsing / at risk

**Shared definitions:** `lapseRule.js` (the bounds `:44-52`, `lapseState :115-125`, `sql :146-162`, the pledge hold `:89-98`), and `donorStatus.statusSql :106-169`, which carries `lifecycle = 'lapsed'` and the `lapsing` column (with rhythm and pledge hold). FIX-51 says "every door reads this file". In practice they read the **bounds** and then apply them to different last-gift dates, with or without the pledge and rhythm exceptions.

**Places that decide lapsed, lapsing or at risk: 21.**

| Place | How | Verdict and differences |
|---|---|---|
| `donorStatus.js:106` `statusSql` (tags, `/donors/counts` `routes/donorLookups.js:97-108`, list filter `groups.js:102` → `tagCondition`, `donors-by-status`, `quietIds :175` → `routes/crm.js:22577`, `server.js:5323`) | the one rule on the `amount > 0` last date | **shared** |
| `lapseRule.lapseState` callers: `routes/crm.js:979` move suggestions (with pledges and rhythm), `routes/why.js:1149` (`isLapsed`, **no pledge hold**), `drift.js:169` (`isLapsed`, no pledge hold), `readout.js:107` (a gap between two gifts) | the pure function | by construction. The ones without pledges differ from the tag for a person with an open pledge. |
| `server.js:3530-3560` `autoLapseOrg` (writes **`donors.stage = 'lapsed'`**) | `bounds().lapsedOnOrBefore` on the stored **`last_gift_date`** + pledge hold | **semi.** It uses the stored date, which counts refunds and credits. It is a stored stage that can go stale. `server.js:3576-3587` moves people back. |
| `routes/crm.js:6380-6386` and `10565-10571` (imports write `suggested_stage = 'lapsed'`) | `(today − last_gift_date) >= LAPSED_DAYS` + pledge hold | **by luck**; the same as above |
| `server.js:7230` `computeAtRiskCandidates` ("at risk", also `routes/crm.js:19717`) | `lapseRule.sql('lapsing', last_gift_date)` + its own `total_giving >= 5000`, `stage NOT IN ('prospect','lapsed')` | semi. The stored date; "at risk" adds a $5,000 floor that nothing else uses. |
| `server.js:7693` sequence re-engage | `lapseRule.sql('lapsed', last_gift_date)` AND `stage = 'lapsed'` | semi |
| `server.js:8979-8998` `donor_lapsed` workflow | `lapseDays` from config (default 365), cutoff from **`Date.now()` in UTC**, `last_gift_date < cutoff` | **by luck.** The process clock instead of the org's day, a strict `<` against the rule's `<=`, no pledge hold, no rhythm. It writes a literal `lapsing` **typed tag** (`server.js:8315`), which then lives in `donors.tags` beside the computed Lapsing tag. |
| `routes/crm.js:13605-13608` `lifecycleRows` (journeys) | `lapseRule.sql` on `last_gift_date` | semi (the stored date) |
| `routes/crm.js:21476` `/dashboard` | `lapseRule.sql('lapsed', last_gift_date)` | semi |
| `routes/crm.js:26867-26890` `/impact` re-engage candidates | bounds + rhythm + pledge on its own `MAX(date) WHERE amount > 0` | semi. No imported last gift, so someone whose only giving is imported never appears. |
| `routes/crm.js:19347,19646,19651,19742` my-stats and `/dashboard/today` | `stage = 'lapsed'` | reads the **stored stage** (`autoLapseOrg`), not the tag |
| `routes/donorLookups.js:107` `reengage` count | `stage = 'lapsed' OR lifecycle = 'lapsed'` | mixes both definitions |
| `routes/crm.js:21183-21190`, `21238-21246` lapsed-recovery goals | a gap of at least `LAPSED_DAYS` between two gifts | **by luck.** 21244 has no `org_id` on the inner query and no deleted filter. |
| `routes/crm.js:26810-26816` `/impact` re-engaged | the same gap rule via `LAG` | by luck |
| `insights.js:419-423,691-693` the Lapsing card | `slipping && timeQuiet`, up to **548 days**, a rhythm or **274-day** rule | **a different rule.** Its own window (data end, not today), calendar-year "yearBehind", households as one unit. Shown on Home as "Lapsing donors". |
| `shared/lostAndFound.js:171-283` (browser) | `lapseState(lastPositive(d), today)` with **no rhythm and no pledges**; "at risk" = quiet + drifting | **by luck.** It differs from the tag for a pledger or a yearly giver. |
| `client/src/components/DonorDirectory.jsx:102` Re-engage tab | `stage === 'lapsed' OR (!pledgeHold && isLapsed(lastGift))` | client-side. The stored date, no rhythm. |
| `client/src/components/donorShared.jsx:28` | `days >= 365 → 'lapsed'` | client-side by luck (the import stage) |
| `client/src/components/shared.jsx:330-342` risk score | `days > 365/270/180`, `status === 'lapsed'` | client-side by luck ("At risk" words) |
| `routes/crm.js:20186` `/dashboard/today` `atRiskAmount` | the sum of `usualGift` from drift | its own "at risk" dollars |
| `why.js:493` | `atRiskCents: usual` | its own "at risk" dollars |

**Truth check:** "lapsed people" (lines 375-378) compares `/donors/counts.lapsed` with `/donors?lifecycle=lapsed` total. **Both are `statusSql`**, and there is **no database value**, so it can only fail if the list filter and the count stop sharing `statusSql`. Every other row above is outside it.

### 5. First-time donor

**Shared definitions:** `donorStatus.js:134` lifecycle `new` (no positive gift before the 12-month window and no imported earlier gift). The `givers` source with `first: new` (`figureSources.js:528-559`; `MIN(date) WHERE amount > 0`, **no imported first gift**). `retention-window-prior` with `firstYear` (`FIRST_GIFT_IN`). Imported first gift: `donorSummary.IMPORTED_FIRST`.

**Places: 12.**

| Place | How | Verdict and differences |
|---|---|---|
| `donorStatus.js:134` | `new` tag | **shared** (imported history counts as giving before) |
| `figureSources.js:543-546` `givers first=new` | `MIN(g2.date) WHERE amount > 0 >= from` | **shared** for Reports. It **ignores imported first gifts**, so a person with old-system history reads "new" in Reports and "Current" on their tag. |
| `routes/crm.js:24317,24339` giving summary | `givers first=new` | by construction |
| `routes/crm.js:24668-24672` annual report `new_donors` | own CTE: `MIN(date)` over **all** rows (refunds and credits included), no imported first gift | **by luck.** The report then hands out `givers first=new` as the figure's source (`24702`) while the value is `split.new_donors` (`24717`). The units leg of the truth check compares those two. |
| `askEngine.js:146-153` `new_donor_count` | own `MIN(date) WHERE amount > 0` | by luck (matches `givers`, not the tag) |
| `askEngine.js:386-399` `firstYearRetention` | first gift ever in the **calendar** year before | by luck |
| `insights.js:491-511` `firstTime` stat | per **household**, calendar year, credits out | by luck. It is the "N of M first-time donors gave again" sentence. |
| `insights.js:713-735` second-gift card's first gift | `x.firstDay`, units | by luck |
| `callsToMake.js:51-58` `first_time` | own `MIN(LEFT(date,10)) WHERE amount > 0` | by luck |
| `readout.js:91-94` `new_donors` | "no older gift on file" in the readout's rows | by luck; it is switched off on a first import |
| `groups.js:164-166` `firstGiftFrom` | `MIN(LEFT(gn.date,10)) WHERE amount > 0` | by luck (matches `givers`) |
| `routes/crm.js:23828` AI board report "new this quarter" | **`donors.created_at`** in the quarter | **a different meaning**: new records, not first gifts |
| `routes/crm.js:28526,28596` event `firstTime` | own SQL (the event's first gift) | by luck. Not read further in this pass. |

Also: `engagement.js:300` and `donorStatus.js:215` `isNew` for the closeness word "New" use a first-seen date (gift, interaction or shift), which is a different meaning again.

**Truth check: not covered** (only through the units leg, which checks a report's figure against its own source).

### 6. Retained / second gift

**Shared definitions:** `server.js:12231` `computeRetentionRate` (fiscal, `amount > 0`, live) behind the `retention` source (`figureSources.js:2874,2940`), which its comment says matches `retention-window` (`figureSources.js:1627-1666`, `amount > 0`, live). The person tag is `donorStatus.js:157-158,166` `retained` (fiscal `cyFrom`/`lyFrom`).

**Places: 11.**

| Place | How | Verdict and differences |
|---|---|---|
| `server.js:12231` `computeRetentionRate` | fiscal via its own `fyOf`, `amount > 0` | **shared**. A fourth fiscal-year boundary. |
| `figureSources.js:1627,1646` `retention-window-*`, `2889-2922` | `amount > 0`, live | **shared** for Reports |
| `donorStatus.js:157` tag `retained` | fiscal, `amount > 0` | **shared** for the tag |
| `routes/crm.js:21336,21426,2038` | `computeRetentionRate` / `retention-retained` | by construction |
| `routes/crm.js:22825` `/annual-fund` | `computeRetentionRate(orgId, { year, gifts })` | **wrong input.** It passes the **calendar** year (`parseCivil(today).y`) as `year`, which the function reads as a **fiscal start year**, so for a July org the annual-fund page's retention is FY(year to year+1) beside a calendar-year raised total. |
| `routes/crm.js:24676-24681` annual report retention | own SQL; the "again" side has **no `amount > 0`** and no deleted filter | **by luck.** A refund counts as giving again. |
| `routes/crm.js:23832-23842` AI board report | own SQL, **calendar** years, no deleted filter, refunds count | **by luck** |
| `insights.js:510` `retainedFromPrior` | households, **calendar** years | by luck |
| `askEngine.js:386` `firstYearRetention` | calendar, `amount > 0` | by luck |
| `insights.js:397-398,713-735` second-gift rung and card | `occasions` (giving days per household) `=== 1` | by luck; a separate "second gift" meaning |
| `routes/profileStatus.js:196-200` | `giftCount === 1` (the stored `gift_count`) → "ask for a second gift" | by construction of the stored count; differs from insights (households, days) |
| `routes/crm.js:14583` journey `secondGift` | own SQL, "gave again within a year" | by luck. Not read further in this pass. |
| `why.js:574` | "no second gift" reason | own SQL. Not read further in this pass. |

**Truth check: not covered** beyond units (`/reports/retention` figure equals its own source).

### 7. Major donor and every other donor tag

`donorTags.js` computes no tag. It only hides machine flags (`has-refused-rows:N`, `shares-id:`) from the typed tags in `donors.tags`. The computed tags are all in `donorStatus.statusSql` (level General/Mid/Major, lifecycle New/Current/Recaptured/Lapsed, Retained, Lapsing, Pledge payment overdue). The closeness word comes from `donorStatus.closenessSql :207` and `shared/engagementWeights.js:93` `closenessFor`. Lapsing and lapsed are covered in #4.

**"Major" places: 9, on four different definitions.**

| Place | Definition | Verdict |
|---|---|---|
| `donorStatus.js:131` level `major` | **last 12 months** net (credits **included**, refunds off) ≥ `orgs.giving_level_major_cents` (default **$10,000**, `:34`) | **shared** for the tag, `donors-by-status`, groups and the giving-level chart |
| `insights.js:262-271,395` rung `major` | L12 **or any single gift** ≥ `orgs.ladder_major_line_cents`, else **min($5,000, top 5% of unit lifetimes)** | **a different rule and a different setting**, per household. Drives the Major tab, "Major donor slipping" and "the director" as owner (`:576`). |
| `server.js:6524-6527` digest | `percentile_cont(0.9)` of `total_giving` (strictly above) | own SQL |
| `routes/crm.js:20437-20440` `composeThreads` | the same p90, copied | own SQL (a copy) |
| `routes/homeLead.js:36-39` `orgLine` | the same p90, copied | own SQL (a copy) |
| `shared/threadRank.js:144-145` | `lifetimeGiving > majorThreshold`, labelled "**Top tenth** of your donors by lifetime giving" | reads the p90 above |
| `groups.js:360-364` `topTenth` group | `ROW_NUMBER() ≤ CEIL(n/10)` by `total_giving` | **by luck.** It differs from the p90 copies on ties and interpolation, though both say "top tenth". |
| `insights.js:770` `majorSlipping` | the rung, plus calendar-year `byYear` ≥ line | from the insights rule |
| `client/src/lib/majorGifts.js` | permission gate, not a threshold | n/a |

**Other tag-like stored values that shadow the computed tags:** `donors.stage = 'lapsed'` (#4), the `lapsing` typed tag written by the workflow (`server.js:8315`), and `donors.suggested_stage` from imports (`routes/crm.js:6380`, `10565`).

**Truth check: not covered.** No tag is compared to anything.

### 8. Pledge balance, received, due by a date

A delegated sweep found these places. I checked `routes/crm.js:21730` and `24798` myself (`SUM(p.amount - COALESCE(pp.paid,0))`, no `GREATEST`); the rest are as that sweep read them.

**The core split: pledges have two "paid" models.** The balance is `p.amount − SUM(gifts WHERE pledge_id = p.id)`. Due and overdue come from `pledge_installments.paid_gift_id IS NULL`. The only bridge between them is `pledgeWrite.js:61-85` `splitPaid`, which runs when a schedule is written. A payment linked to the pledge but not to an installment lowers the balance and leaves the installment "due".

**Shared definitions:** `figureSources.js:2061` `pledges-open` (balance, `status='open'`). `figureSources.js:317` `pledgesDueSql`, used by `pledges-due` (`:2334`, `<=`) and `pledges-overdue` (`:2344`, `<`). `figureSources.js:2078` `pledge-payments`. `numbers.js:346` `pledgeSummary()` wraps the first three. `server.js:3714` `recalcPledgePayment` writes the stored paid amount and status. `server.js:3752` `OPEN_PLEDGE_REMAINING_JOIN` says "every pledged figure reads this", but **nothing uses it**.

**Places: 36. About 8 by construction, about 28 by luck.**

By construction:
- `routes/crm.js:22135` Fundraising overview, via `pledgeSummary`.
- `routes/crm.js:22251` `/fundraising/pledges` totals.
- `routes/crm.js:2073,2074,2168` `/dashboards/fundraising`.
- `askEngine.js:361` and `shared/askCatalog.js:56` `pledged_outstanding`.
- `numbers.js:201,308` event pledged, via `EVENT_PLEDGE_OPEN`. Installments only, so it can differ from the Pledges rows' balance (see below).

By luck, open balance or paid:
- `routes/crm.js:22253-22283` `/fundraising/pledges` rows. Per row, `dueThisYear` and `overdue` are capped at the balance (`Math.min`); the truth is not.
- `routes/crm.js:7800-7850` `/donors/:id/pledges` (the profile). Own SQL. It names `pledges-open` as its source but does not call it. `dueThisYear` is its own installment query, capped.
- `routes/crm.js:7580` the gift-POST balance.
- `routes/crm.js:21852` campaign rows. The same math as `pledges-open`, but it claims that source at `:21975` without calling it.
- `routes/crm.js:21730` `/campaigns/:id/progress`. **No `GREATEST`**, so an overpaid pledge lowers the total.
- `routes/crm.js:24798` solicitations report. **No `GREATEST` and no deleted-donor filter.**
- `routes/crm.js:11191` gift match "received". No status filter.
- `routes/give.js:6181` donor portal paid and balance, all statuses. **Donor-facing.**
- `routes/grantSystem.js:359` grant received.
- `insightsData.js:30` and `insights.js:307,342,433,798-811`, Home's "still to come" move:
  - status is "not fulfilled, cancelled or written off" instead of `open`;
  - grouped by household;
  - "due this year" is the **calendar** year and is not capped.
- `shared/reportBuilder.js:100-101` report fields. No status filter.
- `donorList.js:297` and `:487`, the same SQL written twice in one file.
- `routes/agent.js:1065,1118`. "Open" is the **full `p.amount`**, not the balance.
- `routes/sheetImport.js:967` and `routes/crm.js:9029`, the import receipt (from the file).
- `db.js:2396`, a one-time migration.

By luck, due or overdue:
- `routes/crm.js:19484,19492` Home late-installment and needs-schedule counts.
- `routes/crm.js:13684` the `pledge_late` trigger.
- `server.js:3010` installment reminders. The paid subquery has **no `org_id`**.
- `server.js:9057,9068` the `pledge_due` workflow. It reads `p.due_date` only and ignores installments.
- `server.js:9164` `first_overdue_at`. It reads `p.due_date` only and ignores the balance. It feeds `DonorProfile.jsx:3056` "Nd overdue" and `goingOut.js:76` (full amount).
- `lapseRule.js:84` `PLEDGE_OVERDUE`, which feeds the tag. An unscheduled pledge is overdue whatever its balance.
- `calendar.js:205`. Unpaid means `pi.paid_at IS NULL`, **not `paid_gift_id`**, and an unscheduled pledge shows the full amount.
- `routes/crm.js:9616` deposit matching.

Client code only displays server values (`OpenPledgeBanner.jsx:41`, `DonorProfile.jsx:3064`, `Pledges.jsx`, `Fundraising.jsx:547`).

Other visible differences:
- `pledges-open` uses a `LEFT JOIN` to live donors, so it **keeps pledges with a NULL or missing donor**; the truth requires a live donor.
- A Stripe refund or dispute **deletes** the gift (`routes/webhooks.js:994,1090`). The balance rises and `paid_gift_id` is set to NULL, but `paid_at` stays, so the calendar still shows that installment as paid.

**Truth check:** lines 414-449 and 642-663 hold its own SQL for open, due this fiscal year and overdue. They are compared against `/fundraising/pledges` (totals and rows), Fundraising overview, `/dashboards/fundraising`, every profile's `/donors/:id/pledges`, `/figures/pledges-open/rows?donor=` and Home's "still to come" move. The event leg (line 460) compares an event's pledged with the Pledges rows' balance. Outside it: the campaign progress, solicitations report, portal, agent, calendar, workflows and `first_overdue_at`.

### 9. Event attended / gave / came and didn't give

Mostly from a delegated sweep. I read the predicates at `figureSources.js:380-406` myself.

**Shared definitions:**
- The predicates `EVENT_GUEST_LIVE`, `EVENT_INVITED`, `EVENT_DECLINED`, `EVENT_CAME`, `EVENT_REGISTERED`, `EVENT_NO_REPLY`, `EVENT_ATTENDED_GAVE` and `EVENT_PERSON_GAVE` (`figureSources.js:395-406`).
- `numbers.js:244` `eventGuests()` (each person once) and `numbers.js:287` `eventStory()`.
- The sources `event-guests :2153`, `event-attended :2201`, `event-gave :2216`, `event-registered :2242`, and `events-year-*`.
- "Gave" is household-aware: a gift above zero or a pledge that is not cancelled, with credits left out.

**Places: 28. About 10 by construction, about 18 by luck.**

By construction:
- `routes/crm.js:28544` `/events/:id/report`.
- `routes/crm.js:28608` `/events/:id/rows`.
- `routes/crm.js:28900`, the overwrite in `/events`.
- `routes/crm.js:22161` Fundraising lead event.
- `routes/insights.js:68` and `insights.js:1071`, Home's Grow `came_no_gift`.
- `routes/why.js:916` Ask.
- `routes/crm.js:29130` the per-guest amount given.
- `Events.jsx:163,169` the card.
- `Events.jsx:1878` the year tiles. These use the **browser's** calendar year.

Partly or wholly by luck:
- `routes/crm.js:28686` kiosk. `expected` and `checkedIn` count **rows, not people**.
- `routes/crm.js:28868` `/events` `invited_count` stays the raw row count, with cancelled and declined rows included.
- `routes/crm.js:29105` `GET /events/:id` and `:28959` `PUT`. `attendee_count` is `status='attended'` only and **ignores `checked_in_at`**.
- `Events.jsx:1477` the "N people came" text. It filters on `status==='attended'` and counts rows, while the server's follow-up count (`crm.js:29308`) uses `EVENT_CAME` per person.
- `routes/homeLead.js:196` Home's upcoming-event guests are a **sum of seats** (`quantity`). Check-ins and no-shows are left out.
- `groups.js:394` `attendedEvent` (a checked-in declined row counts).
- `groups.js:396` `registeredEvent` (a NULL or empty status counts as registered).
- `groups.js:218` `attendedNoGift`, which is the Donors list filter "Came to an event and didn't give" (`donorList.js:138,390`). It is a **different definition**: no gift above zero from that person since the event's date, for any purpose. No pledges, no household, not tied to the event.
- `groups.js:526-531`, `donorList.js:494`.
- `routes/crm.js:13744` and `13789` (triggers).
- `routes/crm.js:14647` the audience filter (`status='attended'` only).
- `routes/crm.js:8168` the statement's events.
- `engagement.js:90,144`, `routes/templates.js:111`.
- `figureSources.js:228` `ACTIVITY_SQL` (status only).
- `shared/eventShape.js:172` `guestCame`, which is the same rule in JS.
- `Events.jsx:35` `isIn` (does not exclude declined rows).

Where `eventGuests` differs from the truth check's own SQL:
- The truth's `attended` is `COUNT(*)` of **rows**; `eventGuests` counts people.
- The truth decides `declined` row by row, while `eventGuests` puts each person in one bucket (came, then registered, then declined).
- `event-registered` groups by `COALESCE(a.donor_id, a.id)`, while `eventGuests` uses `COALESCE(d.id, a.id)`.

**Truth check:** lines 150-168 (database counts per event: live, attended, registered, declined, invited) and 478-537. They compare the event page figures and story, its rows, the figure drawer, the Events list, the kiosk, Fundraising's lead card, Home's Grow and Ask. "Came and didn't give" and "gave" are checked **only surface against surface, and by their adding up**; there is no database value. Outside it: `GET /events/:id`, the EventDetail text, Home's seat count, every group or list filter, and the audience filter.

### 10. A suggested ask amount

**Shared definition:** `engagement.js:399-437` `suggestedAsk` → `shared/smartAmounts.js:188` `suggestedAskCents` (anchor = max(largest, average of the last three) rounded to a friendly rung, one step up if rising, held when Room to give is unknown, adjusted by screening). It reads gifts with `amount > 0`; **credit rows are not filtered out** (a $10,000 soft-credit row can set "largest") and there is no deleted check, which is fine per person.

**Places: 9 (6 by construction, 3 separate rules).**

| Place | How | Verdict |
|---|---|---|
| `engagement.js:399` | shared | **shared** |
| `routes/crm.js:15759` profile scores, `routes/crm.js:20521` threads, `routes/profileStatus.js:208` next step, `why.js:635,772`, `routes/why.js:251,755` | call `suggestedAsk` | **by construction** |
| `insights.js:631,673,702,726,742,774` (card asks) | **six separate rules**: Retain = last December's giving; Sponsor = last level; Lapsing = last gift; Second gift = first gift; Upgrade = `naturalCents(1.5 × L12)`; Major = a range of 50-100% of last year | **separate rules**, each with its own rounding (`wholeDollars` and `naturalCents`, not `toFriendlyCents`). Home's cards can show a different ask from the profile's "Suggested ask" for the same person. |
| `server.js:6515-6519`, `routes/crm.js:20421-20426` `asks` | `SUM(opportunities.target_amount)` open | the **open ask** (proposals), a different number with the same word. `figureSources.js:999` `donor-open-ask` is its source. |
| `shared/smartAmounts.js:149` | the giving-form preset amounts | a different concept (form buttons) |

**Truth check: not covered.**

### 11. People vs households counts

Mostly from a delegated sweep. I checked `routes/donorLookups.js:40` myself (`SET = "org_id = ? AND deleted_at IS NULL"`).

**People: 27 places, and there is no shared "live person" function.** Four filters are in use: (a) not deleted; (b) not deleted and not sample; (c) `groups.buildDonorFilter` with `hideArchived`; (d) `buildDonorFilter` without it.

| Place | Filter | Note |
|---|---|---|
| `routes/donorLookups.js:97-108` `/donors/counts` total | (a) | **Counts sample and archived people.** It is read by `client/src/lib/people.js:48`, `Dashboard.jsx:261`, `WelcomePage.jsx:229,314,326`, `shared.jsx:239` and `Donors.jsx:907`. |
| `routes/crm.js:4265` `GET /donors` total, `:4418` CSV export | (c) | **Leaves out archived people, counts sample people.** It disagrees with `/donors/counts` whenever someone is archived. |
| `routes/crm.js:3306` onboarding card, `:9236-9251` Home's file line | (b) | The only two that match the truth's filter. The second is a copy of the first. |
| `routes/crm.js:29432` workbook, `:29544` zip | (a) | Sample people are included on purpose. |
| `routes/crm.js:4315` summaries header, `server.js:9781` plan limit, `routes/billing.js:840,2303,2338,2455`, `routes/support.js:64`, `routes/sheetImport.js:521`, `routes/agent.js:2406`, `askQuery.js:32`, `sendGateMigration.js:70`, `setup.js:654` | (a) | |
| `routes/crm.js:3765`, `routes/billing.js:2259` | (b) | |
| `routes/crm.js:3780` load-sample guard | **no `deleted_at` filter** | |
| `server.js:9436-9443` billing band | (a) + at least one gift | |
| `routes/why.js:231` "show me" | (d) | It counts archived people, unlike the Donors list. |
| `routes/crm.js:23784,23826` AI board report | (a) | It calls everyone "total donors". |
| `insights.js:530,534,540,996-999`; `Insights.jsx:253,528` | units | **"N people" counts a household as one person.** |
| `shared/sheetRead.js:1637` import preview | per record | "John & Mary" counts as 2. |

**Households: 13 places, with no shared function.**
- `askQuery.js:209` counts rows in the households table, including a household whose members are all deleted.
- Move Report: "held" (`routes/crm.js:9375`, `COUNT(DISTINCT external_household_id)` over people the import created) is compared with "file" (`shared/movePlan.js:300-326`, distinct keys from gift rows) at `movePlan.js:364`. **These are two different populations.** The drill keys `move_households` and `move_people` are served nowhere.
- `shared/sheetRead.js:1698` preview: records that carry a household name, not distinct names.
- `routes/crm.js:10039` Undo preview, and `sampleData.js:178`.
- `routes/crm.js:24543-24560` Top donors by household. `memberCount` is the members who gave, not the household's size, and credit rows are counted.
- `routes/crm.js:10799` `/households`, and `routes/search.js:109`.
- `routes/crm.js:10958-10966` `householdCombined`. **A copy of `figureSources.js:605` `household-giving`**, adding float dollars.
- `insights.js:230-242` `buildUnits` and `routes/insights.js:118`.
- `db.js:8951` (logs only).

**Truth check:** "people" (lines 240-249) uses filter (b) and compares it with the list (c), `/donors/counts` (a), the onboarding card (b), Home (b), the CSV (c), the workbook (a) and the zip (a). It **can go red** with one sample person (the list, counts and exports differ) or one archived person (the list and CSV differ). **No households truth.**

### 12. Net, fee, deposited / undeposited

Mostly from a delegated sweep. I confirmed myself that the only app write to `deposit_ref` is the Undo restore (`routes/finance.js:426`).

**Fee and net: 13 places.** The shared candidate `shared/giftFooting.js:57-79` (clamps gross ≥ 0 and the fee between 0 and gross, knows whether the fee is known) is called **only** by `routes/give.js:5214` and the demo seed.

By luck:
- `routes/crm.js:24870-25021` `reportBookkeeper`.
  - It reads `COALESCE(fee,0)`, so an unknown fee is $0, and it ignores `processor_fee_source`.
  - There is no clamp, so a refund row keeps its fee.
  - It leaves out credit types with `LOWER(COALESCE(type,''))` **without `TRIM`**, while its own figures use `LOWER(TRIM(...))` (`figureSources.js:422`).
  - Sample gifts are counted.
- `depositsFile.js:63-133`.
- `client/src/components/DonorProfile.jsx:1603,2987` (float dollars).
- `qboSync.js:211,450-469` and `xeroSync.js:139-147,246` (credit types **not** left out, unlike the bookkeeper).
- `shared/bookkeeping.js:108-169` (the fee comes from the request body).
- `shared/payoutReconcile.js:52-99` (the fee comes from Stripe, not `gifts`).
- `shared/connections.js:138-152` (no caller found).
- `server.js:2347,2720` and `Settings.jsx:2612` (giving-source sync).
- The cover fee: `shared/processingRates.js:156`.
- "Intended" amount: `server.js:5059,5069` and `routes/give.js:6129`, which re-derive giftFooting's `intendedCents`.

The writers make a giving-source gift whose fee is unknown read as a known $0 fee (`server.js:1315,1320`, `shared/givingSources.js:226-231`).

**Deposited / undeposited: 7 places, four definitions.**
- `routes/finance.js:128-135` `ON_NO_DEPOSIT`: on a deposit sheet **or** `deposited_on` set. Undeposited means check, cash, bank transfer or ACH in the last 90 days, measured by the **database's `CURRENT_DATE`**.
- `routes/finance.js:4113-4125` month close: the same predicate, but a **different list of methods** (leaves out bank transfer and ACH, adds blank and unknown) over the month.
- `routes/crm.js:24977` bookkeeper `no_deposit`: **`deposit_ref` empty**, for any method.
- `depositsFile.js:49-54,76` (and `depositCount` / `undepositedDays`, `routes/crm.js:25076`): matched only when `deposit_ref` is set.
- `qboSync.js:680-742`: groups by `deposit_ref`.

Only `deposited_on` is ever written (`routes/finance.js:413`, `routes/sheetImport.js:934`). **No app code writes `deposit_ref`** except Undo (`routes/finance.js:426`) and the demo seed. So outside the demo, Finance can say a gift is on a deposit while the bookkeeper's file and the deposits file say it is not matched.

**Truth check:** only the units leg (lines 709-713, `tests/lib/units.js:79-91` `feeProblems`), on the bookkeeper's rows: the fee is at least 0 and below its gift, and net equals gift minus fee. The bookkeeper computes net as exactly that and turns a null fee into 0, so **only a stored fee at or above its gift can fail it**. `/reports/deposits` is fetched (line 679), but it returns no `figures`, so it checks nothing. **No deposited/undeposited truth.**

---

## 3. Dead weight

### scripts/

Read-only audit of the 221 tracked code files under `scripts/` (.js/.sh/.sql/.html). 19 non-code tracked files (images, CSV, JSON, txt, webm, md) are listed at the end and not classified.

Callers are found by grepping every tracked text file (excluding audit/ and lockfiles) for the basename, `scripts/<stem>`, or `/<stem>'`. Kinds: workflow, githook, battery-sh (tests/run-all.sh, tests/shard.sh), tests, scripts, server (root *.js, routes/, shared/, middleware/), client, package.json, CLAUDE.md, NEEDS-JONATHAN, tests/README, decisions (docs/decisions), HISTORY (docs/HISTORY.md), docs (other docs/), root-md (MANUAL-STEPS.md, PROGRESS.md etc.). A count is files, not lines. Many 'tests' and 'server' hits are comments, not calls; the verdicts were checked against the actual lines.

Note: tests/script-guards.test.js classifies every top-level scripts/*.js by name (a prod-write guard list). That is not counted as a caller, but deleting a script means removing its name from that list too.

#### Totals

| verdict | scripts | lines |
|---|---:|---:|
| keep: Jonathan runs it | 29 | 3283 |
| keep: CI/tests use it | 41 | 9855 |
| one-time, ran already | 151 | 21436 |
| **all** | 221 | 34574 |

#### Ten biggest one-time scripts

| path | lines | last commit |
|---|---:|---|
| scripts/fix5-walk.js | 413 | 398520d 2026-09-28 FIX-5: Journeys, premium and yours |
| scripts/fix4-walk.js | 401 | 2a8633b 2026-09-28 FIX-4 — the six things Jonathan found |
| scripts/build50-capture.js | 399 | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script |
| scripts/vol2-walk.js | 351 | c96b817 2026-09-28 VOL-2: Volunteers stands on its own |
| scripts/vol1-walk.js | 343 | 2c6b784 2026-09-28 VOL-1 — Steward Volunteer |
| scripts/build57-import-drill.js | 329 | ea5e21f 2026-08-16 BUILD-57 §2b+§2c: full-entropy import ids (batch-abort collision closed), hostile-import drill + 14-finding catalogue, lifetime-vs-itemized labels |
| scripts/build81-capture.js | 323 | 0af1241 2026-10-13 POLISH-2: every word sounds like us, the copy and craft sweep from PREMIUM-1 (#188) |
| scripts/build89-walk.js | 313 | 364c2b3 2026-09-18 FIX: the Thread row takes Drift's shape |
| scripts/build102-walk.js | 312 | 6111f8d 2026-10-02 PARITY-1 E: donation form gaps and the starter email gallery (#103) |
| scripts/build84-capture.js | 307 | bc60e66 2026-09-09 FIX: an error handler may not blame the data for a bug — plus the Geocodio number, the receipt cap, and a link instead of a refusal |

#### Every script

| path | lines | what | last commit | callers | verdict |
|---|---:|---|---|---|---|
| scripts/admin-clean.js | 242 | ADMIN-CLEAN Part 5 · SORT EVERY ORG INTO ITS KIND, AND CLEAR THE JUNK. DRY RUN BY DEFAULT. It prints one line per org, by name and id only: the… | 5bebc02 2026-10-11 ADMIN-CLEAN: the admin console and Metrics show only what's real (#177) | NEEDS-JONATHAN, HISTORY, decisions, tests (test spawns it; NEEDS-JONATHAN + decisions (Jonathan runs on prod)) | keep: CI/tests use it |
| scripts/agent2/fixture.js | 79 | AGENT-2 · the fixture org the 30 instructions run against (scratch only). BASE=http://localhost:5841 DATABASE_URL=…/steward_agent2 node… | 27e9b24 2026-10-03 AGENT-2: an Agent that does the work (#133) | scripts | one-time, ran already |
| scripts/agent2/run30.js | 139 | AGENT-2 · run the 30 instructions on the fixture and score what really happened in the system: a row-level diff of the whole fixture org, judged… | 27e9b24 2026-10-03 AGENT-2: an Agent that does the work (#133) | none | one-time, ran already |
| scripts/agent3-walk.js | 107 | AGENT-3 Muse walk, on a LOCAL Harborlight (the scratch database's own seed) with the model on. At 1440 it types the three prompts into the Agent,… | 15284bd 2026-10-07 AGENT-3: the Agent sees everything (#163) | none | one-time, ran already |
| scripts/attribution-chips-capture.js | 67 | DSF3 screenshots for the attribution-completeness FIX — the Home hero chips (Pace · This FY · This week · Re-engaged) with the shared interactive… | b8e8c2a 2026-08-04 FIX: attribution completeness — giving pages, pledges, refunds, fees, grants + hero chips | HISTORY | one-time, ran already |
| scripts/audit-gate.js | 42 | BUILD-75 B.6 — the npm-audit FAILING gate, with NAMED exceptions. 'npm audit --audit-level=high' alone can't be a gate here: two highs have no… | ad26e33 2026-09-03 BUILD-75 B.4-B.6: orphan routes deleted, the not-covered list, the free layer | workflow | keep: CI/tests use it |
| scripts/auto-mail-switches-readonly.sql | 35 | READ-ONLY. Once check c of the nightly check (removed): no automatic donor mail past a switch that is off. Over the last 25 hours of email_log (it… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | server×3, HISTORY, decisions | keep: Jonathan runs it |
| scripts/auto1-walk.js | 111 | AUTO-1. Journey steps that send themselves, at 1440 then 390, on the local stack. On the scratch Harborlight (a demonstration org, so nothing is… | 5158228 2026-10-21 AUTO-1: journey email steps that send themselves (staff words, owner's switch, weekday mornings) (#228) | none | one-time, ran already |
| scripts/backfill-campaign-attribution.js | 116 | BUILD-32 Part 1 (item 5) — backfill campaign_id for historical gifts. Before BUILD-32, manual/imported gifts could only carry a free-text… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY, decisions | keep: Jonathan runs it |
| scripts/build-local-dist.sh | 37 | Build client/dist for the LOCAL scratch stack (the browser suites' target). Every VITE_* override the local preview needs, in one place — a dist… | f2c155a 2026-10-30 FIX-60: a pledge is activity, numbers carry their unit, and the SWEEP-5 leftovers (#280) | CLAUDE.md, HISTORY, decisions, scripts×4, tests×4 | keep: Jonathan runs it |
| scripts/build101-demo-seed.js | 111 | BUILD-101 — the memberships demo, on an org this script creates. "Lakeside Arts Center (Demo)": three levels, a dozen members across Active, Grace… | f2c155a 2026-10-30 FIX-60: a pledge is activity, numbers carry their unit, and the SWEEP-5 leftovers (#280) | none | one-time, ran already |
| scripts/build102-walk.js | 312 | BUILD-102 (Steward Give) — THE WALK. SELF_REFUSING. The brief's own ending, on a real org through the real routes, in a real browser at 390 AND 1440: | 6111f8d 2026-10-02 PARITY-1 E: donation form gaps and the starter email gallery (#103) | none | one-time, ran already |
| scripts/build12-ui-capture.js | 114 | BUILD-12 app-UI capture — crisp DSF3 verification screenshots for the three app-side parts (enriched palette, no page-subtitle blurbs, everything… | 17b7e2b 2026-07-18 BUILD-12 app UI: Finance header inline layout + app-wide clickability (Grants/Comms) | root-md | one-time, ran already |
| scripts/build14-capture.js | 73 | BUILD-14 DSF3 screenshot capture — households, portfolio color, planned-giving. Local only: drives a vite preview (BASE) wired to a local backend,… | 5d897df 2026-07-18 BUILD-14 frontend: household card, officer portfolio colors, planned-giving filter | HISTORY | one-time, ran already |
| scripts/build15-capture.js | 70 | BUILD-15 DSF3 screenshot capture — moves management & prospect pipeline. Local only: drives a vite preview (BASE) wired to a local backend,… | ed0db4c 2026-07-18 BUILD-15: moves management & prospect pipeline (Team-gated major-gifts spine) | HISTORY, scripts | one-time, ran already |
| scripts/build17-capture.js | 67 | BUILD-17 DSF3 screenshot capture — development reporting cadence. Local only: drives a vite preview (BASE) wired to a local backend, logging in as… | b6bbd52 2026-07-18 BUILD-17: development reporting cadence — digests + 3-year/annual/solicitations reports | HISTORY | one-time, ran already |
| scripts/build19-capture.js | 63 | BUILD-19 DSF3 screenshot capture — pipeline reconciliation + solid titles. Local only: drives a vite preview (BASE) wired to a local backend. Part… | 3d1e590 2026-07-18 BUILD-19: one canonical pipeline (retire Donors→My Pipeline backdoor) + solid page titles | none | one-time, ran already |
| scripts/build19-home-capture.js | 44 | BUILD-19 Home tweak — My Portfolio leads + expanded by default. Captures Team Home (portfolio at top, expanded, retention/signals below) and… | 7a5bbe6 2026-07-18 BUILD-19 Home tweak: My Portfolio leads + opens expanded | none | one-time, ran already |
| scripts/build21-capture.js | 59 | BUILD-21 DSF3 capture — Home typed/roll-up hero + Funds (negative balance) + the error-boundary fallback. Playwright is deliberately NOT a project… | 35bf3bd 2026-07-19 BUILD-21: fix real Funds crash (undefined fundBalances), docs + DSF3 screenshots | none | one-time, ran already |
| scripts/build22-capture.js | 71 | BUILD-22 DSF3 screenshot capture — smart moves + in-view drill-downs. Same conventions as scripts/build15-capture.js etc.: Playwright is NOT a… | 28652c7 2026-07-19 BUILD-22: DSF3 capture script + screenshots (suggested move, auto-lapse moves, in-view drill-down) | none | one-time, ran already |
| scripts/build25-workflows-capture.js | 131 | BUILD-25 Part A — capture the real workflow-recipe artifacts for review. Drives the LOCAL scratch server (booted with… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/build28-capture.js | 44 | BUILD-28 — DSF3 screenshots of the image-forward landing. PLAYWRIGHT_DIR=/path/with/playwright BASE=http://localhost:4173 \ node… | 9cfed29 2026-07-30 FIX: remove landing pottery band + retire off-brand emerald on public/auth surfaces | none | one-time, ran already |
| scripts/build28-prepare-images.js | 56 | BUILD-28 — one-time landing photography asset generator. Converts the licensed source photos (staged in ~/Downloads) into the responsive WebP… | 9cfed29 2026-07-30 FIX: remove landing pottery band + retire off-brand emerald on public/auth surfaces | client, decisions | one-time, ran already |
| scripts/build34-capture.js | 143 | BUILD-34 DSF3 capture + live drive — customizable Home (edit mode). Drives the REAL flow end-to-end, not just screenshots: enter edit mode via the… | 886c0ab 2026-08-04 FIX: canonical email base URL (publicUrl.js, every link on stewardapp.dev) + Home edit-mode Move-to-top | HISTORY | one-time, ran already |
| scripts/build35-capture.js | 115 | BUILD-35 DSF3 capture + live drive — the "Set up Steward" activation checklist. Drives the REAL flow on a FRESH org end-to-end: fresh state (1/6),… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/build36-bulkassign-capture.js | 71 | BUILD-36 B2 — capture the Directory bulk "Assign owner ▾" bar (active + a pending-invite officer in the dropdown). Seeds a small Team org, logs in… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | none | one-time, ran already |
| scripts/build36-invite-capture.js | 33 | BUILD-36 B1 — capture the rebuilt (on-brand) invite-accept page, desktop + mobile. Renders the built client from a local 'vite preview' and… | 5b5f0fc 2026-08-05 BUILD-36 B1: invite page on-brand (cream/serif/gold) + brand guard extended to the auth bucket | none | one-time, ran already |
| scripts/build36-notify-capture.js | 131 | BUILD-36 Part A — capture the real officer-notification emails for review. Drives the LOCAL scratch server (booted with… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/build40-mobile-capture.js | 127 | BUILD-40 — 390px mobile evidence capture (before AND after; pass OUT=). Chrome's minimum window width is 500px, so a plain resize can never reach… | bb71e1e 2026-08-06 BUILD-40: mobile overhaul at true 390px — fail-open reveals, hero 640w, layout compression | HISTORY | one-time, ran already |
| scripts/build41-capture.js | 178 | BUILD-41 — donor surfaces at a TRUE 390px viewport: live drive + DSF2 shots. Asserts (against the local stack — see the env recipe below): Donor… | 1a63ace 2026-08-06 BUILD-41: solid-ink hero + donor list/profile rebuilt for 390px | HISTORY, tests | one-time, ran already |
| scripts/build45-portal-capture.js | 102 | BUILD-45 — portal demo capture (deliverable 6 evidence). Prereqs (the standing local capture recipe, tests/README.md + CLAUDE.md): 1. scratch… | f57ee87 2026-08-10 BUILD-45 deliverables: FINDINGS, routes inventory, data-handling doc, BLOCKED-custom-domains, demo seed + captures, CLAUDE.md | HISTORY | one-time, ran already |
| scripts/build46-capture.js | 108 | BUILD-46 §8(5) — DSF2 screenshots of the donor dashboard demo (run seed-build46-network-demo.js first) + the org-side unchanged proof. Local stack… | 887bf2e 2026-08-12 GO-LIVE prep: Vercel git auto-build OFF for main (Actions-only, proof run green first); LOWER(email) donor index; interim scoped legal sections + required consent on both signups; consumer brand = plain Steward | HISTORY | one-time, ran already |
| scripts/build47-capture.js | 136 | BUILD-47 — DSF2 screenshots of the Find-Your-Nonprofits directory + the /giving design pass, at 390 AND 1440, with DOM assertions. Self-seeding… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/build48-capture.js | 275 | BUILD-48 — DSF2 screenshots + DOM assertions for the ADAPTIVE ORG TAKEOVER, at 390 AND 1440: the three states (zero orgs → neutral shell · exactly… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | none | one-time, ran already |
| scripts/build49-capture.js | 122 | BUILD-49 — DSF2 screenshots + DOM assertions for the DONOR FRONT DOOR, at 390 AND 1440: • the signed-out /giving landing page (hero + auth card +… | 1d5babe 2026-08-13 BUILD-49: donor front door — /giving landing page + network_listed-gated entry points | HISTORY | one-time, ran already |
| scripts/build50-capture.js | 399 | BUILD-50 — consumer-surface design polish: DSF2 screenshots + DOM assertions for BOTH polished surfaces at 390 / 1440 / 2560: • the signed-out… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | none | one-time, ran already |
| scripts/build54-capture.js | 229 | BUILD-54 §7 — screenshot + assertion pass over the new donor-experience surfaces, against the LOCAL stack (tests/README.md recipe). Prereqs (the… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | scripts | one-time, ran already |
| scripts/build55-capture.js | 196 | BUILD-55 — screenshot + assertion pass: the portal-editor layout rework (real desktop render, centered phone frame, collapsible library, options… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | none | one-time, ran already |
| scripts/build57-capture.js | 175 | BUILD-57 Part 1 — screenshot + assertion pass for the staff recurring surface: Fundraising → Recurring Giving (movement summary, at-risk queue,… | ea5e21f 2026-08-16 BUILD-57 §2b+§2c: full-entropy import ids (batch-abort collision closed), hostile-import drill + 14-finding catalogue, lifetime-vs-itemized labels | HISTORY | one-time, ran already |
| scripts/build57-import-drill.js | 329 | BUILD-57 §2b — the hostile import drill: a deliberately messy donor file, imported UNATTENDED through the REAL import surface (the browser UI a… | ea5e21f 2026-08-16 BUILD-57 §2b+§2c: full-entropy import ids (batch-abort collision closed), hostile-import drill + 14-finding catalogue, lifetime-vs-itemized labels | none | one-time, ran already |
| scripts/build57-prod-capture.js | 64 | BUILD-57 §2d — eyes on the LIVE portal. The BUILD-55 impact-precedence change went donor-visible on prod without a human ever looking at it there;… | 7ad1755 2026-08-16 BUILD-57 §2a: real-Stripe drill — 7 mock-blinded webhook bugs fixed (subscription PIs carry no email, 2025+ event shapes, reprice product rules, stripe-node options bug, recovery event ordering); §2d prod captures; differences list + live-drill runbook | none | one-time, ran already |
| scripts/build58-stripe-drill.js | 183 | BUILD-58 Part 3 — boundary drills against REAL Stripe test mode. LOOPBACK ONLY: drives the scratch server on :5621 (never prod) with the authed… | b7490c6 2026-08-16 BUILD-58 Part 3: the boundary audit — real-Stripe drills, dispute handling, the fixture-provenance property | HISTORY, docs, decisions×2, tests×2 | keep: Jonathan runs it |
| scripts/build59-capture.js | 84 | BUILD-59 — portal visual pass: seed two themed local orgs with the cleaned images (installation → hero, gallery → hero, church → card only), set… | d7b361b 2026-08-17 BUILD-59 core: portal banner image system — focal point, srcset/CLS, color band, scrim, type/spacing scale | HISTORY | one-time, ran already |
| scripts/build59-install-demo-images.js | 65 | BUILD-59 — install the cleaned hero banners into the EXISTING prod demo orgs (not fresh orgs — build59-capture does that). GUARDED: loopback… | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | root-md | one-time, ran already |
| scripts/build61-capture.js | 35 | BUILD-61 — local capture of the giving page (read-only, loopback only). Requires: a localhost-API client build served by 'vite preview' on :4173,… | 05978c2 2026-08-17 BUILD-61 Part 1: the unthemed default is a designed experience | none | one-time, ran already |
| scripts/build61-prod-verify.js | 131 | BUILD-61 Part 0 — prove BUILD-60 is VISIBLE on prod, not just green in tests. Read-only: loads the LIVE giving page for each demo org and asserts… | f03ab5e 2026-08-17 BUILD-61 Part 0: BUILD-60 deployed + visibly verified on prod | none | one-time, ran already |
| scripts/build64-capture.js | 147 | BUILD-64 — render the donor-facing ARTIFACTS Jonathan has never seen: the receipt cover email, the year-end cover email, the magic-link sign-in… | e3dd079 2026-08-17 BUILD-64: donor-facing artifacts belong to the org — emails + PDFs from the shared theme resolver | none | one-time, ran already |
| scripts/build72-capture.js | 209 | BUILD-72 Part 5 — THE WALK. Drives the real app in a real browser at 1440 and 390, as a stranger would, and captures every screen. It does NOT… | 197ac5b 2026-08-30 BUILD-72 Part 5: the demo seed and the walk — four defects only a populated org shows | none | one-time, ran already |
| scripts/build72-cents-audit.js | 174 | BUILD-72 Step A — the CENTS MEASUREMENT. READ-ONLY. No writes, ever. Why this exists: Part 1's reconciliation invariant compares dollars in the… | c207b94 2026-08-29 BUILD-72 Step A: cents measurement — blind spot closed, prod run BLOCKED on a credential | scripts | one-time, ran already |
| scripts/build72-date-audit.js | 258 | BUILD-72 Part 4 — THE DATE-BOUNDARY ENUMERATION. Read-only source scan. The type discipline this build adopts: INSTANTS    — created_at, webhook… | 092b189 2026-09-26 FIX-1 split, step 0: readSource() — suites read the source through one helper | server, scripts | one-time, ran already |
| scripts/build73-cents-audit.js | 280 | BUILD-73 Part 1 — THE PRODUCTION CENTS AUDIT. READ-ONLY. No writes, ever. WHY THIS REPLACES scripts/build72-cents-audit.js… | d9095cb 2026-08-31 BUILD-73 Part 1: the production cents audit — measured, not argued | none | one-time, ran already |
| scripts/build73-landing-capture.js | 62 | BUILD-73 Part 4 — the landing captures. Read-only, loopback-only. A green build proves nothing about a page a human has to read. These are the… | ee2ed3e 2026-08-31 BUILD-73 Part 4: the landing page, rebuilt around the donor dot field | none | one-time, ran already |
| scripts/build73-money-audit.js | 97 | BUILD-73 Part 2 — THE MONEY SOURCE SCAN. Pure static analysis: reads server.js off disk, touches no server, no database, no network. Built the… | 092b189 2026-09-26 FIX-1 split, step 0: readSource() — suites read the source through one helper | server, scripts, tests | keep: CI/tests use it |
| scripts/build75-phase0-audit.js | 240 | BUILD-75 Phase 0 — TWO PRODUCTION AUDITS. READ-ONLY. No writes, ever. 0.1 — RECEIPT NUMBERING. allocateReceiptNumber (server.js) derives the year… | 737a52d 2026-09-02 BUILD-75 Phase 0: measure before fixing — both prod audits clean | none | one-time, ran already |
| scripts/build75-route-inventory.js | 50 | BUILD-75 B.1 — enumerate the attack surface MECHANICALLY, never by hand. Boots the real server.js against the scratch stack (never prod — refuses… | a784ef6 2026-09-03 BUILD-75 B.1+B.2: the route inventory + the generated isolation matrix — 26 defects fixed | CLAUDE.md, HISTORY, decisions, scripts, tests (CLAUDE.md command; tenant-matrix test message) | keep: Jonathan runs it |
| scripts/build76-drift-drill.js | 224 | BUILD-76 Part 3.2 — DRIFT AGAINST REAL STRIPE, test mode, no mocks. The Stripe mock lied in seven ways once (BUILD-57); this drill is the no-mock… | 6de0caf 2026-09-03 BUILD-76 Part 3: proven end to end — real import, real Stripe, real refunds, the walk | HISTORY, docs | keep: Jonathan runs it |
| scripts/build78-capture.js | 147 | BUILD-78 walk — the mapper with the new fixture at 1440 and 390, the summary's two axes, the profile's custom fields, and the in-browser date… | d17d6c2 2026-09-04 BUILD-78 Parts 5+6: the surfaces, the export, and the round trip that proves them | none | one-time, ran already |
| scripts/build78-migration-reconcile.js | 100 | BUILD-78 — INDEPENDENT MIGRATION RECONCILIATION (read-only). The honest answer to "was the EAV→JSONB migration really zero-loss?" — the one the… | 34c5bed 2026-09-05 BUILD-79 Part 7: the deploy artifact is a code path — shared/ modules, the tarball guard, and a smoke that 'aligned' requires | none | one-time, ran already |
| scripts/build78-repro-crossorg-fieldid.js | 56 | BUILD-78 Part 0 — FAILS-FIRST REPRODUCTION (committed as the red record). The claim under test (spec Part 7, "the subtle one"): org A referencing… | 08ba3a6 2026-09-04 BUILD-78 Part 1 follow-up: brand token for the refusal message, repro script classified + self-refusing, local dist rebuild | none | one-time, ran already |
| scripts/build79-capture.js | 168 | BUILD-79 verification walk — the same file that broke Steward eight ways on Sept 5, back through the real UI on a FRESH org, at 1440 and 390.… | 1676a95 2026-09-05 BUILD-79 Part 8: the v2 golden joins CI beside v1, and the verification walk goes green end to end | none | one-time, ran already |
| scripts/build79-repro.js | 170 | BUILD-79 Part 0 — the fails-first record. Imports steward-messy-2500-v2.csv (a report export: title line, generated-by, blank, header on line 4,… | 6788b57 2026-09-05 BUILD-79 Part 0: the fails-first record — eight failures, eight numbers, one screen | none | one-time, ran already |
| scripts/build80-capture.js | 193 | BUILD-80 verification walk — the same fixture, back through the REAL UI on a FRESH org, at 1440 and 390: money conventions, dd/mm inference,… | 85476e5 2026-09-05 BUILD-80 verification: the walk, the screenshots, the read-aloud, the findings | none | one-time, ran already |
| scripts/build81-capture.js | 323 | BUILD-81 verification walk, the human path: a FRESH org · the v2 messy import · log one call · watch the next step come back · receive the nudge… | 0af1241 2026-10-13 POLISH-2: every word sounds like us, the copy and craft sweep from PREMIUM-1 (#188) | client, HISTORY | one-time, ran already |
| scripts/build82-capture.js | 206 | BUILD-82 verification walk — the v3 workbook through the REAL UI on a fresh org: sheet roles with evidence, the signals questions with the legend… | 9fdc77b 2026-09-06 BUILD-82: the read-aloud pass — gift rows not gifts, 800 rows not people, a sane percent example, totals-panel refusal counts match the invariant; final walk 40/40 green (51.3s full walk incl. gift-alone leg) | none | one-time, ran already |
| scripts/build82-repro.js | 104 | BUILD-82 Part 0 — REPRODUCE. Fresh org, open steward-messy-25k-v3.xlsx in the real importer, capture the three failing screens BEFORE any fix: 01… | d033a87 2026-09-06 BUILD-82 Part 0: reproduce — the three failing screens + the 53,900 split (46,086 no-donor / 7,814 no-amount) | none | one-time, ran already |
| scripts/build83-capture.js | 212 | BUILD-83 verification walk — v3 through the REAL UI on a fresh org, at 1440 and 390: four signal items and no bogus colour prompt, 800 exclusions… | 36d0649 2026-09-08 FIX: 266 folds had no undo record (the workbook's flat merge shape hit a silent continue) — fold shape rebuilt with gift ids, unstorable shapes reported, fold/unfold pinned end to end; the read-back is now derived from a declared promise field list and carries cash, merges, pledges vs payments and refusals by reason (which immediately caught two more gaps); the receipt shows the money and the set-aside list; batch size is a round-trip budget — 1,914 trips to ~236, measured through a latency proxy; the two timings are named | none | one-time, ran already |
| scripts/build83-repro.js | 141 | BUILD-83 VERIFICATION WALK (was the Part 0 repro; same script, same answers, now asserting the fixed behaviour). Set B83_REPRO=1 to run it as the… | 73f3246 2026-09-08 BUILD-83 verification: walk ALL GREEN 29/29 — and it caught two real defects the suites could not (the exclusion promise was in rows while the database holds records; 709 gifts were being collapsed by the idempotency unique because the collision rewrite was thrown away when no row was refused). One sustainer definition for Home, the tab, the tiles and the checklist | none | one-time, ran already |
| scripts/build84-capture.js | 307 | BUILD-84 verification walk — the REAL 444-row lead file through the REAL UI on a fresh org, and then the Map. This is the hour that found all four… | bc60e66 2026-09-09 FIX: an error handler may not blame the data for a bug — plus the Geocodio number, the receipt cap, and a link instead of a refusal | HISTORY | one-time, ran already |
| scripts/build85-capture.js | 156 | BUILD-85 verification walk — THE FOLLOW-UP ENGINE, on screen. The suite proves the contracts; this proves the thing a person actually sees. It… | d5c8c64 2026-09-15 BUILD-85: the Thread stops being a record and becomes an engine | HISTORY, server | one-time, ran already |
| scripts/build86-capture.js | 126 | BUILD-86 Part A verification walk — HOME AT 7:40, AND THE BOARD MEETING. The brief asks for this by hand on Wednesday; this is that hour,… | c466f8e 2026-09-16 BUILD-86 C.2: Home reads like a note, and is only four things | HISTORY | one-time, ran already |
| scripts/build86-notes-fixture.js | 73 | BUILD-86 C.2 — THE NOTE FIXTURE. Twenty rendered notes, in a row, so a human can read them and hear whether any sound like a machine. The brief… | c466f8e 2026-09-16 BUILD-86 C.2: Home reads like a note, and is only four things | docs | one-time, ran already |
| scripts/build87-f1-walk.js | 229 | BUILD-87 F.1 verification walk — THE DIALOGS, MEASURED. tests/modal-shell.test.js holds the source property (there is ONE shell and everything… | 0af1241 2026-10-13 POLISH-2: every word sounds like us, the copy and craft sweep from PREMIUM-1 (#188) | HISTORY | one-time, ran already |
| scripts/build87-f3-walk.js | 279 | BUILD-87 F.3 verification walk — HOME, LAID OUT. F.3 is a layout pass, so the walk reads GEOMETRY off the real screen rather than grepping source:… | 364c2b3 2026-09-18 FIX: the Thread row takes Drift's shape | HISTORY | one-time, ran already |
| scripts/build88a-dedupe-gifts.js | 89 | BUILD-88a A.1 — DE-DUPLICATE AN ORG'S GIFTS. Dry run by default. Why this exists: before A.1 there were five places that wrote a gift row, and two… | eb136fe 2026-09-16 BUILD-88a A.3: Finance, editable and fed | HISTORY, decisions, tests | keep: CI/tests use it |
| scripts/build88a-walk.js | 146 | BUILD-88a — THE WALK. Log a conversation on the demo org with a gift and a next step, in a real browser, then ask every reader what it holds. The… | 0af1241 2026-10-13 POLISH-2: every word sounds like us, the copy and craft sweep from PREMIUM-1 (#188) | root-md, HISTORY | one-time, ran already |
| scripts/build88b-deposit-timing.js | 161 | BUILD-88b B.1 — TEN CHEQUES, BEFORE AND AFTER. The brief asks for one pair of numbers: how long ten cheques take the way it worked before, and the… | 0af1241 2026-10-13 POLISH-2: every word sounds like us, the copy and craft sweep from PREMIUM-1 (#188) | HISTORY | one-time, ran already |
| scripts/build88b-walk.js | 200 | BUILD-88b — THE WALK. A ten-line deposit slip, typed, then Home. No real Heart of Africa or Sparrow Missions slip has been shared, so the slip is… | 8945524 2026-09-16 BUILD-88b: the walk, the defect it found, and the record in CLAUDE.md | HISTORY | one-time, ran already |
| scripts/build88c-walk.js | 169 | BUILD-88c — THE WALK. Open Communications, pick Appeal, send yourself a test, and read it at a phone's width. The brief's walk ends at… | 6111f8d 2026-10-02 PARITY-1 E: donation form gaps and the starter email gallery (#103) | HISTORY | one-time, ran already |
| scripts/build89-demo-seed.js | 281 | BUILD-89 — THE DEMO FILE. One thousand donors that look like a real organisation's file, so a demo shows the product working instead of the… | 00008f5 2026-09-17 BUILD-89: Home, organised | root-md, HISTORY, docs, server, scripts | one-time, ran already |
| scripts/build89-walk.js | 313 | BUILD-89 verification walk — HOME, ORGANISED. A layout pass is measured on the rendered page, never grepped out of the source. This file began as… | 364c2b3 2026-09-18 FIX: the Thread row takes Drift's shape | HISTORY, scripts | one-time, ran already |
| scripts/build92-close-org-walk.js | 202 | BUILD-92 — the walk for "click an organization and close it from there". The suite proves the ROUTE attaches instead of creating. This proves the… | 8cc2ad9 2026-09-20 BUILD-92: close an organization that is already in Steward, from its own row | none | one-time, ran already |
| scripts/build95-cheque-drill.js | 81 | BUILD-95 — THE CHEQUE-READING DRILL. SELF_REFUSING. The suite proves the arithmetic: two readings that agree settle a line, and every other case… | a16f8da 2026-09-22 BUILD-95: the cheque reading, which proposes and cannot post | root-md×2, NEEDS-JONATHAN, HISTORY, decisions, tests (NEEDS-JONATHAN/MANUAL-STEPS manual drill; fix29 test only counts a string in it) | keep: Jonathan runs it |
| scripts/build97-number-census.js | 355 | BUILD-97 Part 2 — THE NUMERIC CENSUS SCANNER. A PURE SOURCE SCAN: reads the client's active surfaces off disk and finds every place a NUMBER is… | 9a9ea2d 2026-10-06 GRANTS-1: grants as its own system (#150) | client×2, decisions, docs×2, tests | keep: CI/tests use it |
| scripts/build99-brief-drill.js | 97 | BUILD-99 (major gifts) Part 4 — THE PROSPECT-BRIEF DRILL. SELF_REFUSING. 'tests/build99-brief.test.js' proves the REFUSALS: the schema has nowhere… | 0290780 2026-09-24 BUILD-99 (major gifts) Part 4: a brief the schema cannot lie in | NEEDS-JONATHAN, HISTORY, decisions, scripts | keep: Jonathan runs it |
| scripts/build99-walk.js | 159 | BUILD-99 (major gifts) — THE WALK. GUARDED_WRITERS. The brief's own ending: on the demo org, one proposal walked from Identified to Committed with… | 8bcded2 2026-09-24 BUILD-99 (major gifts): the walk, the CLAUDE.md entry, and the one line for Jonathan | NEEDS-JONATHAN, HISTORY | keep: Jonathan runs it |
| scripts/capture1-make-fixtures.js | 199 | CAPTURE-1. THE FAKE DOCUMENTS. Writes the committed fixtures in tests/fixtures/capture1/: three checks, a deposit slip, a pledge form, a… | 96e343b 2026-10-18 CAPTURE-1: checks and gift letters become cards in To confirm; nobody types a gift (#203) | HISTORY, scripts, tests×2 | keep: CI/tests use it |
| scripts/check-numbers.js | 445 | NUMBERS-1 · EVERY NUMBER ADDS UP, AND WE CAN PROVE IT. Reads one organisation (or every one) and checks, to the cent, that the numbers Steward… | f2c155a 2026-10-30 FIX-60: a pledge is activity, numbers carry their unit, and the SWEEP-5 leftovers (#280) | server×4, HISTORY, decisions, docs, tests×6 | keep: CI/tests use it |
| scripts/check-webhook-subscriptions.js | 100 | BUILD-63 Part 2 — check-webhook-subscriptions (READ-ONLY, prod-flagged). Diffs the Stripe event MANIFEST (stripeEvents.js, kept honest against the… | fbe40ba 2026-08-17 BUILD-63: close the webhook race CLASS — event manifest + sibling-event ordering fixes | decisions, server | keep: Jonathan runs it |
| scripts/check2-walk.js | 94 | CHECK-2. The Henrietta Duffield check, walked at 1440 then 390, on the local stack. A stand-in model on MOCK answers the check's read exactly as… | 67d8c3d 2026-10-23 CHECK-2: checks land on the right donor, from anywhere (#235) | none | one-time, ran already |
| scripts/ckrh-provision.js | 237 | CKRH-1. PROVISION ONE REAL ORGANISATION. Central Kentucky Riding for Hope (Lexington, KY), Steward's first customer. THIS IS NOT A SEED SCRIPT AND… | dbeff05 2026-10-27 FIX-53: mail starts off, and only the super-admin toggle turns it on (#254) | docs, HISTORY (CKRH-1 first-customer provisioning; NEEDS-JONATHAN shows CKRH orgs exist (ran)) | one-time, ran already |
| scripts/clean1-orphan-report.js | 113 | CLEAN-1 follow-up. READ ONLY. The July merge (BUILD-08, replaced by CLEAN-1 on 2026-10-03) moved a hand-kept list of tables and soft-deleted the… | 956f1a9 2026-10-06 WIRE-1: everything talks to everything (#153) | none | one-time, ran already |
| scripts/close-stale-deletions.js | 90 | HARDEN-2 item 4 · CLOSE THE DELETION RECORDS OF PEOPLE WHO ARE ALREADY BACK. A person restored through a door that never closed their deletion… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | NEEDS-JONATHAN, HISTORY, decisions, server, tests | keep: CI/tests use it |
| scripts/consistency-audit.js | 391 | BUILD-23 Part 1 — cross-surface consistency / reconciliation audit. The backward sweep: scan ONE org's real data and report every place a single… | d0c0873 2026-07-19 BUILD-23 Part 1: consistency-audit.js + CREO reconciliation sweep | root-md, HISTORY, docs, decisions×2, package.json | keep: Jonathan runs it |
| scripts/create-billing-products.js | 118 | SUPERSEDED by scripts/stripe-live-prices.js (PRICING-1, the record bands). Kept for the legacy Core/Team/Founding prices only. BUILD-24 —… | 2165a40 2026-10-21 PRICING-1: record-banded pricing and setup fees (#230) | root-md, HISTORY, decisions×2, server (SUPERSEDED by stripe-live-prices.js; still in decisions + routes/billing.js message) | keep: Jonathan runs it |
| scripts/creo-goals-capture.js | 43 | DSF3 capture — CREO Home hero on the typed roll-up (FIX 2026-07-19). Confirms the Home hero shows the overarching FY goal roll-up with its Annual… | 624cd1c 2026-07-19 FIX: exceeded-goal display reads as met/over (not capped 100%) + CREO typed roll-up | HISTORY | one-time, ran already |
| scripts/cross-org-import-readonly.sql | 35 | READ-ONLY. Once check e of the nightly check (removed): no customer holds rows from a file previewed in another org. A commit's audit row… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | HISTORY, server | keep: Jonathan runs it |
| scripts/dedupe-finance-gift-stamps.js | 110 | BUILD-21 Part 3 — de-duplicate double-stamped gift ledger rows. | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY, docs, decisions, scripts, tests | keep: CI/tests use it |
| scripts/demo-real-people-check.js | 92 | FIX-3 C, finding 8 — IS THERE A REAL PERSON IN THE DEMO?  READ-ONLY. The walk found "Jonathan Atkinson $1" in the Harborlight demo's thank-you… | 5607c50 2026-09-27 FIX-3 C: no real person in the demo, and the demo gives like a real nonprofit | docs×3, scripts | one-time, ran already |
| scripts/demo-sites/riverbend/about.html | 12 | Static fictional Riverbend Food Pantry web page (ONBOARD-1 fixture site) | ba011d6 2026-10-18 ONBOARD-1: "Set up Steward for me" - files and a website in, a plan, one Start, ready (#205) | served by server.js /demo-site; linked from riverbend/index.html | keep: CI/tests use it |
| scripts/demo-sites/riverbend/index.html | 29 | Static fictional Riverbend Food Pantry web page (ONBOARD-1 fixture site) | ba011d6 2026-10-18 ONBOARD-1: "Set up Steward for me" - files and a website in, a plan, one Start, ready (#205) | served by server.js /demo-site (static); scripts/seed/onboard1-setup.js points at it | keep: CI/tests use it |
| scripts/demo-sites/riverbend/programs.html | 8 | Static fictional Riverbend Food Pantry web page (ONBOARD-1 fixture site) | ba011d6 2026-10-18 ONBOARD-1: "Set up Steward for me" - files and a website in, a plan, one Start, ready (#205) | served by server.js /demo-site; linked from riverbend/index.html | keep: CI/tests use it |
| scripts/dist-fresh.js | 151 | FIX-60 item 6. IS client/dist BUILT FROM THE CODE THAT IS HERE NOW? The one place the battery (tests/run-all.sh) and the pre-push hook… | f2c155a 2026-10-30 FIX-60: a pledge is activity, numbers carry their unit, and the SWEEP-5 leftovers (#280) | githook, HISTORY, decisions, scripts, tests, battery-sh | keep: CI/tests use it |
| scripts/donor-profile-gating-capture.js | 61 | DSF3 screenshot capture — donor-profile Core/Team split (FIX). Captures a Core donor profile (full CRM core + LockedFeature previews over the… | 12b947b 2026-07-19 FIX: donor-profile Core/Team split — keep CRM core for Core, lock the major-gifts layer to Team | decisions | one-time, ran already |
| scripts/error-digest.js | 263 | HARDEN-1 item 6 · THE ERROR DIGEST. Production exceptions already reach Jonathan one at a time (Sentry email). This reads a day of production logs… | 269724f 2026-10-07 HARDEN-1: make it hard to break (#157) | workflow×2, server | keep: CI/tests use it |
| scripts/events1-walk.js | 277 | EVENTS-1 — THE WALK. SELF_REFUSING. An ED runs a gala from Steward, and the parts a server suite cannot see are most of them: whether the numbers… | dbc1dc1 2026-09-28 EVENTS-1: the events hub | none | one-time, ran already |
| scripts/fin1-walk.js | 265 | FIN-1 — THE WALK. SELF_REFUSING. Every Finance screen on Harborlight, at 1440 AND 390. What it is actually checking, beyond "it draws": | 54e5349 2026-09-28 FIN-1 — the Finance facelift | HISTORY | one-time, ran already |
| scripts/finance-entity-routing-capture.js | 93 | DSF3 screenshots for the Finance entity-routing FIX — the smart routing prompt on the Mellon case (manual $60k money-in naming a foundation with… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/finance-overview-capture.js | 93 | BUILD-10 Part 3 — Finance Overview capture (verification screenshots). Logs into prod with the demo account (read-only: nav + year-basis toggle,… | 2461287 2026-07-17 BUILD-10 Part 3: verification assets + demo ledger fix applied + docs | root-md, decisions | one-time, ran already |
| scripts/fix-build54-demo-photos.js | 102 | BUILD-54 follow-up (2026-08-15) — replace placeholder impact "photos" with real photographs on an EXISTING org. Why: the BUILD-45 demo seed used… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | scripts | one-time, ran already |
| scripts/fix-demo-finance-ledger.js | 98 | BUILD-10 Part 3 — demo Finance ledger coherence fix. The demo org's fin_transactions ledger was inflated to ~$626k Cash on Hand by 76 ORPHANED… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | decisions | one-time, ran already |
| scripts/fix10-walk-org.js | 116 | FIX-10. A FIXTURE ORG FOR THE PROD WALK. FIX-10's walk has to press real buttons on production: read Home's drift card, open the early signs, read… | b3a4bf3 2026-09-30 FIX-10: the prod walk's fixture org, guarded | none | one-time, ran already |
| scripts/fix11-audit-walk.js | 171 | FIX-11 Part 1 verification walk — THE TWO SURFACES, READ IN A BROWSER. Everything Part 1 adds to a screen is here, because the defects that matter… | eb3f0a8 2026-09-30 FIX-11 Part 1: everything leaves a trail, and "+ Log → Gift" makes a real gift (#72) | HISTORY | one-time, ran already |
| scripts/fix11-bcc-walk.js | 66 | FIX-11 Part 5 verification walk — THE BCC ADDRESS, WHERE SOMEBODY WOULD LOOK. INT-4 built the whole inbound path and nothing on any screen said… | c804323 2026-09-30 FIX-11 Part 5: the Resend inbound actually lands on the donor (#76) | none | one-time, ran already |
| scripts/fix11-books-walk.js | 145 | FIX-11 Part 3 verification walk — A BOOKKEEPER EXPORT A BOOKKEEPER CAN USE. The part of this build that was invisible from the server: three… | 50476fc 2026-09-30 FIX-11 Part 3: a bookkeeper export a bookkeeper can use (#74) | none | one-time, ran already |
| scripts/fix11-import-walk.js | 138 | FIX-11 Part 4 verification walk — A GIFT FILE WITH NO DONORS IS NOT A DEAD END. The whole of this part is one screen, and the defect was entirely… | 3e0744b 2026-09-30 FIX-11 Part 4: a gift file with no donors is not a dead end (#75) | none | one-time, ran already |
| scripts/fix11-seating-walk.js | 239 | FIX-11 Part 2 verification walk — TABLES YOU CAN ACTUALLY ADD. Part 2 is almost entirely a screen, so this walk is the verification that matters.… | a2b2690 2026-09-30 FIX-11 Part 2: seating, with tables you can actually add (#73) | none | one-time, ran already |
| scripts/fix2-b-capture-exports.js | 79 | FIX-2 B — capture every Reports export's bytes, so "CSV and PDF unchanged in CONTENT" is a diff, not a claim. node… | 51e8a3f 2026-09-27 FIX-2: the two ratchets the merged battery caught | docs×2 | one-time, ran already |
| scripts/fix3-d-profile-capture.js | 128 | FIX-3 finding 10 — capture TODAY's donor profile and the two mockup directions, at 1440 and 390, into docs/fix-3/profile/.… | e4c1dfe 2026-09-27 HOTFIX-1: revert the FIX-3 D profile rebuild, back to the FIX-2 profile | docs×2 | one-time, ran already |
| scripts/fix30-walk.js | 144 | FIX-30 verification walk, at 1440 and 390, on a LOCAL Harborlight (the scratch database's own seed; nothing here can reach production). §1… | 3b5674f 2026-10-07 FIX-30: repair "runs" states, bridge templates, small fixes (#162) | none | one-time, ran already |
| scripts/fix34c-capture.js | 83 | FIX-34 C · the walk. "Add to:" in Book a visit with two calendars, and the connection card naming the API that refused, at 1440 and 390. Loopback… | b4408bc 2026-10-08 FIX-34: TASKS-2's loose ends before the Monday demo (#173) | none | one-time, ran already |
| scripts/fix34d-capture.js | 101 | FIX-34 D — the walk. A fixture org (org_fix34d_shots) with QuickBooks connected and one fund unmapped, and PayPal connected; captures the… | b4408bc 2026-10-08 FIX-34: TASKS-2's loose ends before the Monday demo (#173) | none | one-time, ran already |
| scripts/fix34e-capture.js | 103 | FIX-34 E: the Tasks walk on local Harborlight. A Thank-you task opens its draft; Mark sent drops awaiting thanks by one; "Select" shows the boxes;… | b4408bc 2026-10-08 FIX-34: TASKS-2's loose ends before the Monday demo (#173) | none | one-time, ran already |
| scripts/fix4-walk.js | 401 | FIX-4 — THE WALK. SELF_REFUSING. Every part of this build has a green server suite, and three of the six items are things a server suite… | 2a8633b 2026-09-28 FIX-4 — the six things Jonathan found | HISTORY | one-time, ran already |
| scripts/fix45-no-em-dash.js | 106 | FIX-45 Part 2.6 · THE EM DASH SWEEP. docs/MESSAGING.md says "No em dashes." This rewrites every long dash a person can read, exactly the ones… | 6a90804 2026-10-19 FIX-45: What Muse found, fixed before Thursday's board demo (#215) | HISTORY, tests×2 (tests mention it in comments only (sweep done 19 Oct)) | one-time, ran already |
| scripts/fix5-walk.js | 413 | FIX-5 — THE WALK. SELF_REFUSING. Five of the six items in this build are things a server suite physically cannot see: whether ONE line passes… | 398520d 2026-09-28 FIX-5: Journeys, premium and yours | HISTORY | one-time, ran already |
| scripts/fix6-walk.js | 265 | FIX-6 — THE WALK. SELF_REFUSING. Six audit defects, and four of them are things a server suite cannot see: whether the queue has buttons, whether… | f2f8030 2026-09-28 FIX-6: six QA defects from the Harborlight audit | none | one-time, ran already |
| scripts/fundraising2-walk-org.js | 50 | FUNDRAISING-2. A fresh org on the LOCAL scratch stack with the three real-shaped files imported (gift history, the dinner, contacts) and the… | 656ade8 2026-10-29 FUNDRAISING-2: every Fundraising screen adds up, and the dinner tells its story (#270) | docs | one-time, ran already |
| scripts/fundraising2-walk.js | 52 | FUNDRAISING-2. Opens every Fundraising screen (each section and part), Events, Grants and the event page, at 1440 and 390, on two orgs, and saves… | 656ade8 2026-10-29 FUNDRAISING-2: every Fundraising screen adds up, and the dinner tells its story (#270) | docs | one-time, ran already |
| scripts/goal-consistency-capture.js | 62 | DSF3 capture — multi-goal display consistency (FIX 2026-07-19). Proves the umbrella (FY2026 Comprehensive Campaign) rolls up to $136k/76% with its… | 94b0128 2026-07-19 docs: DSF3 capture — goal display consistency across Home/Overview/Campaigns | none | one-time, ran already |
| scripts/import-receipts-readonly.sql | 23 | READ-ONLY. Once check b of the nightly check (removed): every import receipt foots against its gifts, to the cent. Per org: the imports whose… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | HISTORY | keep: Jonathan runs it |
| scripts/import-stage-capture.js | 78 | FIX (smart initial stage on import) — DSF3 screenshot capture. Local only: drives a vite preview (BASE) wired to the local backend (API), logging… | 0b4e80d 2026-07-20 docs: DSF3 capture — smart initial stage on import | none | one-time, ran already |
| scripts/import-walk.js | 163 | FIX-55 THE WALK. Drives the real app in a browser the way a person would, on a fresh org, with the real-shaped files: import the gifts, then the… | b66ecbc 2026-10-28 FIX-55: the import screen reads right, and every build ends with a walk (#261) | none | one-time, ran already |
| scripts/import3-walk.js | 125 | IMPORT-3. Allie's event sheet, dropped into an empty org. At 1440 then 390, on the local stack: Donors → Import & tools → Import + History, the… | 692c16f 2026-10-23 IMPORT-3: import adapts to any spreadsheet, starting with a real event sheet (#233) | none | one-time, ran already |
| scripts/import5-pledges-from-import-day-readonly.sql | 26 | READ-ONLY (IMPORT-5). Before IMPORT-5, a spreadsheet pledge with no date in its file and no event date answered was due from the day of the import… | 58cc062 2026-10-29 IMPORT-5: dates never made up, the guests who didn't give, pledges up front, other systems' exports (#268) | decisions | keep: Jonathan runs it |
| scripts/invitation-capture.js | 106 | Invitation pivot (2026-08-06) — live drive + DSF3 screenshots. PARTIALLY SUPERSEDED by BUILD-49 (2026-08-09): public self-serve signup was… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/landing-prod-verify.js | 238 | the marketing site's PROD honesty + quality gate. ── LANDING-2 REBUILD ─────────────────────────────────────────────────────── | 0af1241 2026-10-13 POLISH-2: every word sounds like us, the copy and craft sweep from PREMIUM-1 (#188) | HISTORY, decisions, docs×2, scripts, server, tests×2 (docs/landing/LANDING-2.md; tests reference it as the prod-side guard (not executed)) | keep: Jonathan runs it |
| scripts/landing1-walk.js | 207 | LANDING-1 — THE WALK. SELF_REFUSING. The whole landing page at 1440 AND 390, against the six things the brief names, plus the two rules this page… | 8ec1ee7 2026-09-28 LANDING-1 — the new landing page | HISTORY, docs | one-time, ran already |
| scripts/landing5-capture.js | 34 | LANDING-5 · the mockup captures: Home (six pillars and four) and /pricing, at 1440 and 390. Fails on sideways scroll at 390 and on a console… | 8f4a0df 2026-10-05 LANDING-5: fewer words, more people (#143) | none | one-time, ran already |
| scripts/lf1-walk.js | 228 | LOST & FOUND — THE WALK. SELF_REFUSING. The Node suite proves the audit leaks nothing when it runs in Node. This proves it in a REAL BROWSER,… | 66aa0ed 2026-10-19 FIX-44: Ask names the people it finds; Nightly AI by hand only; error digest as an issue (#213) | HISTORY | one-time, ran already |
| scripts/lib/demoRealPeople.js | 126 | FIX-3 C, finding 8. WHO IS REAL, CONCRETELY. The walk found "Jonathan Atkinson $1" in the Harborlight demo's thank-you list: a real $1 Stripe… | 2c55aae 2026-09-27 FIX-3: the real-people check escapes its LIKE prefix fully (CodeQL js/incomplete-sanitization #80) | docs×3, scripts×2 | keep: CI/tests use it |
| scripts/lib/prodGuard.js | 141 | the two-layer prod-write guard (BUILD-55 Part 1). Born from the 2026-08-15 incident: seed-build50-demo.js defaulted BASE to prod, a bare run meant… | 03ad292 2026-08-26 Identity guard: /health reports product+database; writer scripts assert both | decisions, docs, server, scripts×52, tests | keep: CI/tests use it |
| scripts/lib/readSource.js | 242 | FIX-1: read a source file the way it read before the split. FIX-1 moved server.js's code into routes/<product>.js, App.jsx's tab lists | fdd859d 2026-09-29 FIX-9 Part B: a group you can open, and a blind spot in the security battery | HISTORY, server×9, scripts×4, tests×10 | keep: CI/tests use it |
| scripts/lib/routeInventory.js | 162 | BUILD-75 B.1: the mechanical route walk. ONE inventory builder, used by BOTH scripts/build75-route-inventory.js (which commits… | 43d4c2c 2026-10-03 FIX-20: leftovers from PARITY-2 and PARITY-3 (#121) | decisions, scripts, tests×2 | keep: CI/tests use it |
| scripts/list-vs-home-readonly.sql | 27 | READ-ONLY. Once check d of the nightly check (removed): the Donors list and Home count the same people. Home's "N people on file" (GET… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | HISTORY | keep: Jonathan runs it |
| scripts/load-irs-bmf.js | 171 | FIX-22. Load the IRS Exempt Organizations Business Master File (EO BMF) into irs_bmf, the one table the public filing lookup reads (prospect.js… | b44b935 2026-10-03 FIX-22: what the walks found (#129) | NEEDS-JONATHAN, server×3, HISTORY, decisions, scripts, tests | keep: CI/tests use it |
| scripts/load-irs-ein-registry.js | 69 | BUILD-46 §3.2(1) — load the IRS Tax-Exempt Organization list (Pub 78 data) into ein_registry, the table the network signup gate verifies EINs… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | server, HISTORY, docs, decisions | keep: Jonathan runs it |
| scripts/load/down.sh | 6 | SCALE-1 · stop exactly the processes scripts/load/up.sh started. | 6b462da 2026-10-13 SCALE-1: measure 200 orgs; queue, worker split, shared limits, AI budget, faster Home (#186) | scripts | keep: CI/tests use it |
| scripts/load/env.sh | 25 | SCALE-1 load harness: the server env for the load cluster. Source it, never point it anywhere but localhost. Stand-ins answer every provider on… | b721f9a 2026-10-13 SCALE-2: the shell stops downloading every donor, Home in two requests, stored figures and Drift, faster Gmail first read (#190) | scripts, server | keep: CI/tests use it |
| scripts/load/import-drive.js | 62 | SCALE-1 · a 10,000-row gift file through the same route, in the same 500-person chunks, that the import screen uses (DonorImport.jsx CHUNK), and… | 6b462da 2026-10-13 SCALE-1: measure 200 orgs; queue, worker split, shared limits, AI budget, faster Home (#186) | decisions, scripts, tests | keep: CI/tests use it |
| scripts/load/mailbox-first-read.js | 66 | SCALE-2 · a FIRST mailbox read for a 25,000-donor org, timed and counted. STANDIN=http://localhost:6748 BASE=http://localhost:6741 node… | b721f9a 2026-10-13 SCALE-2: the shell stops downloading every donor, Home in two requests, stored figures and Drift, faster Gmail first read (#190) | none (SCALE-2 one-off measurement) | one-time, ran already |
| scripts/load/measure.js | 203 | SCALE-1 · part 1's numbers, from a LOCAL server on the seeded load database. node scripts/load/measure.js latency   # 20 users, one per large org,… | b721f9a 2026-10-13 SCALE-2: the shell stops downloading every donor, Home in two requests, stored figures and Drift, faster Gmail first read (#190) | decisions, scripts, tests | keep: CI/tests use it |
| scripts/load/seed-many.js | 213 | SCALE-1 · two hundred synthetic orgs on a LOCAL database, from a fixed seed. 20 large  · 25,000 donors · 150,000 gifts · Stripe, QuickBooks, Gmail… | 2f18b18 2026-10-27 HARDEN-2: fast on a phone, and the loose ends from HARDEN-1 (#257) | HISTORY, decisions, tests×2 | keep: CI/tests use it |
| scripts/load/standins.js | 85 | SCALE-1 · the stand-ins a load run talks to instead of the real providers. :6718  Gmail, Google Calendar, Graph, QuickBooks, Xero, Stripe,… | b721f9a 2026-10-13 SCALE-2: the shell stops downloading every donor, Home in two requests, stored figures and Drift, faster Gmail first read (#190) | decisions, scripts×2 | keep: CI/tests use it |
| scripts/load/tick-capture.js | 83 | SCALE-1 · time every background job without touching one. Preloaded into a load-run server ('node -r ./scripts/load/tick-capture.js server.js').… | 6b462da 2026-10-13 SCALE-1: measure 200 orgs; queue, worker split, shared limits, AI budget, faster Home (#186) | scripts×2 | keep: CI/tests use it |
| scripts/load/up.sh | 30 | SCALE-1 · start the stand-ins and a load server against the seeded load database, with every background job held by tick-capture.js so the run… | 6b462da 2026-10-13 SCALE-1: measure 200 orgs; queue, worker split, shared limits, AI budget, faster Home (#186) | scripts, tests×2 | keep: CI/tests use it |
| scripts/loadtest.js | 202 | BUILD-05 load-test driver — autocannon against a LOCAL server seeded by scripts/seed-loadtest.js. Never point BASE at production. Phases (all… | bb2618f 2026-07-16 BUILD-05: load test at 25k donors — index the cliff away, document the ceiling | root-md×2, HISTORY, scripts (BUILD-05; superseded by scripts/load/ (SCALE-1)) | one-time, ran already |
| scripts/local-preview.js | 197 | BUILD-73. The local stand-in for Vercel. WHY THIS EXISTS 'vite preview' serves client/dist as static files and nothing else. In | ca3347d 2026-10-29 SECURE-2: close what SECURE-1 left, and bring back the lost security list (#271) | CLAUDE.md, root-md, HISTORY, docs, decisions×3, scripts, tests/README, tests, battery-sh | keep: CI/tests use it |
| scripts/mail-preflight.js | 76 | MAIL-1 · THE MAIL PRE-FLIGHT. Read-only. Run it before the real Resend key goes back on, and again before switching an org's donor mail on:… | da0242f 2026-10-26 FIX-50: an org is a demo only if its Kind is Demo (Justin's Place) (#245) | HISTORY, decisions, tests×2 | keep: CI/tests use it |
| scripts/migrate-build51-theme-assets.js | 49 | BUILD-51 — migrate existing portal themes to asset storage, API-ONLY: | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | none | one-time, ran already |
| scripts/migrate-build51b-impact-photos.js | 50 | BUILD-51b — migrate existing impact-update photos to asset storage, | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | none | one-time, ran already |
| scripts/migrate-plans-core-team.js | 64 | BUILD-24 — map any existing orgs off the legacy seed/growth/impact plan enum | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/move-theme-assets-to-s3.js | 59 | FIX-58 item 6 · Move the stored files that fell back to Postgres into S3. Before FIX-58, an upload whose S3 put failed every try was kept in… | 1e383a1 2026-10-29 FIX-58: leftovers from IMPORT-5, FUNDRAISING-2, FIX-57 and SECURE-2 (#273) | HISTORY, scripts | keep: Jonathan runs it |
| scripts/nav1-walk.js | 295 | NAV-1 verification walk — A SIDEBAR YOU CAN SCAN. Everything in this build is a screen, so the walk reads the real rail rather than the source: a… | caf5401 2026-10-01 FIX-11 Part 6 follow-up: the sidebar icons are 20px again (#79) | HISTORY | one-time, ran already |
| scripts/nightly-ai/issue.js | 58 | HARDEN-1 item 4 · opens ONE GitHub issue from the nightly run's summary. node scripts/nightly-ai/issue.js <summary.json> [--dry-run] Lists every… | f5ed8a7 2026-10-18 FIX-38: the nightly AI run stops in one line when credit runs out; the error digest lands as a PR (#208) | workflow, scripts | keep: CI/tests use it |
| scripts/nightly-ai/proxy.js | 143 | HARDEN-1 item 4 · THE COUNTING PROXY for the nightly real-AI run. The server under test is booted with a DUMMY key and ANTHROPIC_BASE_URL pointed… | f5ed8a7 2026-10-18 FIX-38: the nightly AI run stops in one line when credit runs out; the error digest lands as a PR (#208) | workflow, scripts, tests | keep: CI/tests use it |
| scripts/nightly-ai/run.js | 344 | HARDEN-1 item 4 · THE NIGHTLY REAL-AI RUN. Twenty-one FIXED questions against a server whose model calls go, through the counting proxy… | 66aa0ed 2026-10-19 FIX-44: Ask names the people it finds; Nightly AI by hand only; error digest as an issue (#213) | nightly-ai.yml; issue.js/proxy.js | keep: CI/tests use it |
| scripts/numbers1-campaign-window.js | 78 | NUMBERS-1 Part 6 · GIFTS CREDITED TO A CAMPAIGN BEFORE IT STARTED (OR AFTER IT ENDED). A gift counts toward a campaign only inside the campaign's… | b0549d4 2026-10-21 NUMBERS-1: every number adds up, and we can prove it (#225) | decisions | keep: Jonathan runs it |
| scripts/onramp-capture.js | 157 | Discovery on-ramp + copy-fix capture (2026-08-12 follow-ups). Prereqs (the standing local capture recipe, tests/README.md + CLAUDE.md): 1. scratch… | f7b1768 2026-08-12 Portal discovery on-ramp + honest password copy (BUILD-46 follow-ups) | none | one-time, ran already |
| scripts/preview-perf.js | 27 | FIX-55 item 1b. How long the import preview takes, file by file, in an org of 2,000 people (500 deleted): the first preview (upload to a full… | b66ecbc 2026-10-28 FIX-55: the import screen reads right, and every build ends with a walk (#261) | HISTORY, tests | one-time, ran already |
| scripts/prod-ai-smoke.js | 76 | HARDEN-1 item 5. ONE ASK AND ONE AGENT PLAN, ON PROD, SAVING NOTHING. FIX-29 reached prod because every test runs with AI off: the Agent's… | 08cd707 2026-10-07 HARDEN-1 follow-up: the AI smoke accepts a clean nobody-matches find (#160) | workflow, CLAUDE.md, HISTORY, scripts, tests | keep: CI/tests use it |
| scripts/profile1-capture.js | 78 | PROFILE-1 — the walk. Captures the donor profile at 1440 and 390 beside the approved mockup (docs/profile-1/mockup.html), and asserts as it goes… | 1891ccb 2026-09-27 PROFILE-1: the donor profile, as approved | docs | one-time, ran already |
| scripts/qboin-walk.js | 138 | QBO-IN, the walk. The stand-in QuickBooks company and fixture org from tests/qboin/standin.js (the ones the guard asserts on), driven through the… | b0b0cd7 2026-10-12 QBO-IN: gifts entered in QuickBooks come into Steward, counted once (#182) | HISTORY, tests | one-time, ran already |
| scripts/repair-runs-state.js | 210 | FIX-30 Part 1 · PUT BACK THE POSTAL STATES THE AGENT OVERWROTE WITH "runs". Before HARDEN-1, an Agent contact update wrote the step's run state… | 3b5674f 2026-10-07 FIX-30: repair "runs" states, bridge templates, small fixes (#162) | NEEDS-JONATHAN, HISTORY, tests (test spawns it; NEEDS-JONATHAN prod run) | keep: CI/tests use it |
| scripts/restore-asset.js | 125 | BUILD-56 Part 3 — restore-asset: get a retained (soft-deleted) portal asset BACK, including the pointer, from the two halves BUILD-56 keeps: • the… | e213c52 2026-08-16 BUILD-56 Parts 1-4: asset retention & undo — soft delete, pointer history, restore, purge, one destruction seam | server, HISTORY, decisions, scripts | keep: Jonathan runs it |
| scripts/screenshot-matrix.js | 203 | Layout screenshot matrix + shell/deep-link smoke checks (BUILD-06 Phase E, re-run for the sidebar-shell restructure). Drives the real built client… | cd1bca8 2026-07-17 BUILD-10 Part 1: full-width top bar | root-md, decisions, scripts (listed in decisions/architecture.md (BUILD-06/08-era; likely stale)) | keep: Jonathan runs it |
| scripts/seed-build45-asks.js | 174 | BUILD-45 D-2 Fix B — seed believable ASKS (opportunities) into the demo org so the Prospect Pipeline header tiles (OPEN ASKS / WEIGHTED FORECAST /… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY | one-time, ran already |
| scripts/seed-build45-portal-demo.js | 133 | BUILD-45 — dress the demo org's donor portal (deliverable 6). API-DRIVEN parts (safe anywhere, incl. prod): enable the portal, set the CREO theme,… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY, scripts×2 | one-time, ran already |
| scripts/seed-build46-network-demo.js | 66 | BUILD-46 §8(5) — demo seed: one donor giving at TWO portal-enabled, network-listed demo orgs, so the dashboard shows the whole story (home cards,… | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | HISTORY, scripts×3 | one-time, ran already |
| scripts/seed-build50-demo.js | 220 | BUILD-50 Part C — demo data for the PRIMARY account (xjca2006@gmail.example.com), so both consumer-dashboard states are viewable signed in as… | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | scripts | one-time, ran already |
| scripts/seed-build54-demo.js | 105 | BUILD-54 §7 — the pilot-org demo: dress ONE campaign with donor-facing content, attribute a large demo gift, and publish a full widget layout on… | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | scripts | one-time, ran already |
| scripts/seed-build86-vocabulary.js | 48 | BUILD-86 Part B — the DEMO ORG'S OWN WORDS. "The demo org gets a vocabulary that is deliberately not the default, so a demo never shows generic… | c1c971f 2026-09-16 BUILD-86 Part B: her words | server | one-time, ran already |
| scripts/seed-creo-goals.js | 135 | FIX (2026-07-19) — set CREO (the Fairhope demo org) up on the BUILD-16/21 typed roll-up goal model so its Home hero shows the overarching FY goal… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | HISTORY, scripts×2 | one-time, ran already |
| scripts/seed-demo.js | 4191 | THE DEMO SEED — Harborlight Youth Collective, the org the pitch is given on. FIX-1 §11: THE DEMO IS ITS OWN ORG, NEVER A TEST FIXTURE. The walk… | 761c9a7 2026-10-26 FIX-49: Jonathan's number decisions, and the Atlas and NUMBERS-2 leftovers (#244) | workflow, CLAUDE.md, NEEDS-JONATHAN, server×2, HISTORY, docs×13, decisions, scripts×14, tests×6, battery-sh×2 (CI nightly-ai.yml + tests/shard.sh run it; CLAUDE.md names it) | keep: CI/tests use it |
| scripts/seed-fundraising-demo.js | 87 | BUILD-11 — seed ONE coherent, healthy, current fundraising campaign on the demo org so the Fundraising Overview (and the landing hero captured… | 523eb2c 2026-08-15 BUILD-55 Part 1: two-layer prod-write guard on every writer script | root-md, HISTORY, decisions (BUILD-11 org_creo demo; decisions mention is historical) | one-time, ran already |
| scripts/seed-loadtest.js | 310 | BUILD-05 load-test seeder — synthetic mid-size org for LOCAL benchmarking. NEVER run against production. Guard below refuses any DATABASE_URL that… | cb8b52d 2026-09-23 INCIDENT 2026-09-22: mail could not tell a real person from an invented one | root-md×2, HISTORY, scripts, tests/README, battery-sh | keep: Jonathan runs it |
| scripts/seed/capture1-inbox.js | 223 | CAPTURE-1. HARBORLIGHT'S "TO CONFIRM" PILE, AND A MONTH OF GIFT-TO-THANK-YOU TIMES. Six cards, each from a committed, plainly fake document in | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | HISTORY, scripts, tests | one-time, ran already |
| scripts/seed/clean1-mess.js | 136 | CLEAN-1 Part 6. Believable mess for Harborlight. What an office's file looks like a year after two imports and a gala: eight pairs of records that… | 2945722 2026-10-03 CLEAN-1: Clean data without the dread (#124) | scripts | one-time, ran already |
| scripts/seed/clientsafe1-meadowbrook.js | 74 | CLIENT-SAFE-1. MEADOWBROOK, IN PRIVACY MODE. Harborlight serves young people, not clients with health records, so privacy | 2167ebd 2026-10-19 CLIENT-SAFE-1: privacy mode. Clients are never brought in, and health details are held back (#212) | scripts | one-time, ran already |
| scripts/seed/email1-demo.js | 201 | EMAIL-1. THE DEMO SHOWS ALL OF IT. Harborlight's one brand (logo, colours, type) in portal_settings, read by its giving pages and its emails… | 628ab85 2026-10-06 EMAIL-1: beautiful emails, built like giving pages (#152) | scripts | one-time, ran already |
| scripts/seed/fix41-media.js | 102 | FIX-41 Part 2. THE DEMO SHOWS PICTURES. Called with one line from scripts/seed-demo.js main(), after the auction, the event pages and the… | 6a90804 2026-10-19 FIX-45: What Muse found, fixed before Thursday's board demo (#215) | HISTORY, scripts×2 | one-time, ran already |
| scripts/seed/home2-days.js | 67 | HOME-2. WHAT LEADS HARBORLIGHT'S HOME TODAY. Home's lead slot shows what matters most today (shared/homeLead.js). The demo carries the three… | 3f0d984 2026-10-21 HOME-2: Home changes with the day (#224) | HISTORY, scripts | one-time, ran already |
| scripts/seed/journeys4-demo.js | 130 | JOURNEYS-4. TWO READY-MADE JOURNEYS ON THE NEW TRIGGERS, WITH PEOPLE ALREADY PART WAY THROUGH. Called with one line from scripts/seed-demo.js… | c598bae 2026-10-11 JOURNEYS-4: journeys start from everything a donor does (#179) | HISTORY, scripts | one-time, ran already |
| scripts/seed/live1-demo.js | 61 | LIVE-1. One example readout and one learned file mapping on Harborlight, so "What changed" has something true to show in a demo. | 5466d80 2026-10-12 LIVE-1: every import and every action feeds the machine (#184) | HISTORY, scripts | one-time, ran already |
| scripts/seed/onboard1-setup.js | 35 | ONBOARD-1. RIVERBEND, BEFORE SETUP. Harborlight is already set up, so "Set up Steward for me" cannot be shown on it. This seeds a SECOND, small… | ba011d6 2026-10-18 ONBOARD-1: "Set up Steward for me" - files and a website in, a plan, one Start, ready (#205) | HISTORY, scripts | one-time, ran already |
| scripts/seed/parity2-auction.js | 97 | PARITY-2 Part 4. HARBORLIGHT'S AUCTION. Twelve donated items, open now: bidding opened three days ago and closes in four. It belongs to the next… | 84416c8 2026-10-02 PARITY-2 Part 4: auctions, first version (#114) | scripts | one-time, ran already |
| scripts/seed/parity2-events.js | 70 | PARITY-2 Part 3. THE TWO PUBLIC EVENT PAGES. Called with one line from scripts/seed-demo.js main(), after the gala and the 5K are written. It only… | 43d4c2c 2026-10-03 FIX-20: leftovers from PARITY-2 and PARITY-3 (#121) | scripts | one-time, ran already |
| scripts/seed/parity2-memberships.js | 37 | PARITY-2 Part 1. THE MEMBERSHIP PAGE. Called with one line from scripts/seed-demo.js main(), after the MEMBERS-2 block has written Harborlight's… | 38e89d0 2026-10-02 PARITY-2 Part 1: the membership page and the org's Give hub (#113) | scripts | one-time, ran already |
| scripts/seed/parity2-p2p.js | 146 | PARITY-2 Part 2. THE SPRING PADDLE. A second peer-to-peer campaign on Harborlight, so the public page has everything to show: a thermometer with a… | 4e03661 2026-10-02 PARITY-2 Part 2: the peer-to-peer page (#111) | scripts | one-time, ran already |
| scripts/seed/parity2-qbo.js | 68 | qbo.js, PARITY-2 Part 5. QUICKBOOKS SYNC ON HARBORLIGHT. Called once from scripts/seed-demo.js main(), after INT-2 has written the demo's… | f516c44 2026-10-02 PARITY-2 Part 5: QuickBooks Online sync, gift by gift, behind a per-org flag (#115) | scripts | one-time, ran already |
| scripts/seed/parity4-dinner.js | 92 | PARITY-4 Part 4. TONIGHT'S SUPPER, HALF SEATED. Called with one line from scripts/seed-demo.js main(). It only ever writes org_b72demo, through… | fa42549 2026-10-04 PARITY-4: keep the money that slips, and lists in plain words (#135) | scripts | one-time, ran already |
| scripts/seed/prospect1-prospects.js | 145 | PROSPECT-1 Part 7. Believable prospects. Ten people whose own files give Room to give something to say (three Strong, four Some, three Not yet… | 956f1a9 2026-10-06 WIRE-1: everything talks to everything (#153) | scripts, tests | one-time, ran already |
| scripts/seed/reconcile1-mismatch.js | 132 | RECONCILE-1. HARBORLIGHT'S 2024 DONORPERFECT FILE DISAGREES WITH STEWARD, BY A KNOWN AMOUNT, FOR TWO REASONS STEWARD CAN FIND. | 8af7a2b 2026-10-18 RECONCILE-1: old reports check the rest of Steward, and say where they disagree (#197) | HISTORY, scripts | one-time, ran already |
| scripts/seed/voice1-memos.js | 128 | VOICE-1. HARBORLIGHT A WEEK INTO TELL STEWARD. Three memos the director "said" over the last week, each with what Steward did with it, stored… | e68ef2e 2026-10-18 VOICE-1: Tell Steward - talk for 30 seconds, and the paperwork is done (#206) | HISTORY, scripts | one-time, ran already |
| scripts/shard-combine.js | 123 | CHORE-2. THE ONE PLACE THAT SAYS THE BATTERY PASSED. CI runs the battery as six parallel shards. A green shard means a sixth of the battery… | 26a7b49 2026-09-27 GTM-1a — one plan priced by active donors, signup reopened, and the browser legs run in CI | workflow, docs, decisions | keep: CI/tests use it |
| scripts/shard-plan.js | 109 | CHORE-2. WHICH SUITES GO IN WHICH SHARD. Longest-processing-time first: sort the suites by their recorded seconds, descending, and drop each one… | fb2a2c6 2026-10-02 FIX-15: the leftovers from FIX-14, GIVE-2 and CAMPAIGN-2 (#95) | docs, scripts, tests×3, battery-sh | keep: CI/tests use it |
| scripts/shard-report.js | 104 | CHORE-2. ONE SUMMARY OUT OF N SHARDS. A sharded run must read like a serial one, or nobody will trust it. This prints exactly one summary:… | fb2a2c6 2026-10-02 FIX-15: the leftovers from FIX-14, GIVE-2 and CAMPAIGN-2 (#95) | docs, battery-sh×2 | keep: CI/tests use it |
| scripts/sql/big-orgs.sql | 47 | FIX-57 item 8 READ-ONLY. One SELECT; it writes nothing, locks nothing it keeps, and is safe to run twice. Jonathan runs it by hand against… | e45a4cb 2026-10-29 FIX-57: leftovers from FIX-56, HOME-4 and SECURE-1, and a CI that stops crying wolf (#269) | HISTORY (header says Jonathan runs it by hand; no doc besides itself) | keep: Jonathan runs it |
| scripts/sql/theme-fallback-rows.sql | 19 | FIX-58 item 6. READ-ONLY. The rows behind /health's themeAssets.dbFallbackRows: stored files whose S3 put failed every try, so their bytes sit in… | 1e383a1 2026-10-29 FIX-58: leftovers from IMPORT-5, FUNDRAISING-2, FIX-57 and SECURE-2 (#273) | HISTORY, scripts | keep: Jonathan runs it |
| scripts/stale-deletions-readonly.sql | 16 | HARDEN-2 item 4. READ-ONLY. Per org: how many people are live (donors.deleted_at IS NULL) but still named by an open deletion record… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | NEEDS-JONATHAN, server×2, HISTORY, decisions, scripts×2, tests | keep: Jonathan runs it |
| scripts/status.js | 201 | Deploy drift-check. Read-only. Run: node scripts/status.js Prints, and LOUDLY flags divergence between, the four things that must agree for "what… | 473a3a0 2026-10-28 NIGHTLY-OFF: remove the nightly check; Home's stored answer is never stale (#258) | npm run status / CLAUDE.md; tests/int-prod-1-guards spawns it | keep: CI/tests use it |
| scripts/stripe-live-prices.js | 111 | PRICING-1. THE BAND PRICES IN STRIPE. For every band in pricing.json this makes sure Stripe has one product ("Steward · Up to 2,500 records",… | 2165a40 2026-10-21 PRICING-1: record-banded pricing and setup fees (#230) | NEEDS-JONATHAN, HISTORY, scripts | keep: Jonathan runs it |
| scripts/tdz-scan.js | 253 | BUILD-96 Part 6. THE TDZ CLASS, FOUND BY GREP. This defect has cost four builds (BUILD-84 'stageBasis', BUILD-89 'onPanel', BUILD-95, BUILD-96… | ba41b68 2026-09-24 BUILD-96 Part 6: four small things, and a grep that took four rounds to be worth running | githook, workflow, CLAUDE.md, root-md×2, client, decisions, server | keep: CI/tests use it |
| scripts/topbar-verify.js | 191 | Top-bar global search verification (BUILD-08). Drives the real built client against a real backend with the demo login — no mocks. Usage: | cd1bca8 2026-07-17 BUILD-10 Part 1: full-width top bar | root-md×2, decisions (listed in decisions/architecture.md + MANUAL-STEPS (BUILD-08-era; likely stale)) | keep: Jonathan runs it |
| scripts/trans1-walk-org.js | 69 | TRANS-1. A FIXTURE ORG FOR THE PROD WALK. The TRANS-1 walk has to press real buttons on production: pick a tile, read the how-to page, import a… | c6c954b 2026-09-29 TRANS-1: a fixture org for the prod walk, so no real org is ever walked | scripts | one-time, ran already |
| scripts/tree-already-passed.js | 89 | CHORE-2. HAS THIS EXACT TREE ALREADY PASSED? A push to main is nearly always the merge of a PR whose head already ran the full battery on the same… | b9b5107 2026-09-27 CHORE-2: one CI job that shards inside itself, not a matrix of three | workflow, docs | keep: CI/tests use it |
| scripts/verify-paypal.js | 115 | INT-PROD-1 · verify-paypal (READ-ONLY, prod-flagged). Proves the live "Steward" PayPal REST app on Railway can do the two things Steward needs of… | c4be904 2026-10-07 INT-PROD-1: guardsOk cause + /health names the guard; QuickBooks preview + disconnect; verify-paypal; Xero granular scope (#170) | NEEDS-JONATHAN, HISTORY | keep: Jonathan runs it |
| scripts/voice1-walk.js | 120 | VOICE-1. Tap to done, at 390 then 1440, on the local stack. The phone leg puts a stand-in for the browser's speech recognition on the page… | c72df14 2026-10-21 VOICE-2 option B: the floating square mic, bottom right, everywhere (#222) | none | one-time, ran already |
| scripts/voice3-walk.js | 165 | VOICE-3. Talk to Steward, at 1440 then 390, on the local stack. One mic, three kinds of talk: what happened (filed), something to do (the Agent's… | 2d721d0 2026-10-21 VOICE-3: talk to Steward (log, do, ask), take out meeting mode (#223) | none | one-time, ran already |
| scripts/voice4-walk.js | 181 | VOICE-4. Margaret Chen (Harborlight), at 1440 then 390, on the local stack. Jonathan's memo from prod, 21 Oct: "Lunch with Margaret went well, she… | c4bdccd 2026-10-21 VOICE-4: Tell Steward does it all, and the screen keeps up (#227) | none | one-time, ran already |
| scripts/vol1-walk.js | 343 | VOL-1 — THE WALK. SELF_REFUSING. The coordinator's week, in a real browser at 1440 AND 390, on the demo org: · the PUBLIC sign-up page on the… | 2c6b784 2026-09-28 VOL-1 — Steward Volunteer | HISTORY | one-time, ran already |
| scripts/vol2-walk.js | 351 | VOL-2 — THE WALK. SELF_REFUSING. Six items, and five of them are things a server suite cannot see: whether the two actions are on screen when the… | c96b817 2026-09-28 VOL-2: Volunteers stands on its own | HISTORY | one-time, ran already |

#### Non-code files under scripts/ (not classified)

- scripts/demo-assets/README.md
- scripts/demo-assets/auction-aquarium.jpg
- scripts/demo-assets/auction-camera.jpg
- scripts/demo-assets/auction-chef-table.jpg
- scripts/demo-assets/auction-cooking.jpg
- scripts/demo-assets/auction-harbor-boats.jpg
- scripts/demo-assets/auction-lake-canoe.jpg
- scripts/demo-assets/auction-ski-snow.jpg
- scripts/demo-assets/auction-wine-grapes.jpg
- scripts/demo-assets/demo-campaign-chapel.jpg
- scripts/demo-assets/demo-hero-choir.jpg
- scripts/demo-assets/demo-impact-exhibition.jpg
- scripts/demo-assets/demo-impact-studio.jpg
- scripts/demo-sites/riverbend/logo.png
- scripts/demo-sites/riverbend/riverbend-salesforce-contacts.csv
- scripts/demo-sites/riverbend/riverbend-salesforce-donations.csv
- scripts/demo-sites/riverbend/robots.txt
- scripts/fixtures/video-thanks-demo.webm
- scripts/lib/splitOrder.json

### Code nothing imports

**Method.** knip and ts-prune need an install and a config for a mixed CJS + Vite repo, so a
two-part check was used instead. Both tools are kept outside the repo.

1. **Files.** In the import graph above, these are production files (root, `routes/`, `shared/`,
   `middleware/`, `client/`) that no non-test file imports. Each candidate was then grepped by
   basename for dynamic loads (`readdir`, `import.meta.glob`, `new Worker(new URL(...))`, prerender
   scripts, HTML entry points). Those found that way were dropped.
2. **Exports.** Every exported name was taken from `module.exports = {…}`, `exports.x =`,
   `export function/const/class`, and `export {…}`. A token index was built over every tracked
   JS/JSX/MJS/HTML file. An export counts as unused when no other file contains the token. It counts
   as **dead** when its own file also mentions it only at the definition (and in the export list).

**Files with no importer (high confidence, 15 files, ~1,760 lines):**

| File | Lines | Note |
|---|---:|---|
| `client/src/pages/Pricing.jsx` | 366 | The marketing site has its own `marketing/pages/pricing.jsx` |
| `client/src/components/Board.jsx` | 258 | Not imported anywhere |
| `client/src/components/HomeLead.jsx` | 188 | Only named in a test's text |
| `client/src/components/Programs.jsx` | 174 | Not imported anywhere |
| `client/src/lib/morningSentence.js` | 165 | No reference at all |
| `shared/publicSources.js` | 162 | Only named in a comment and in SOURCES.md. The allowlist is "still empty". It is a policy file, so ask before removing |
| `client/src/components/AnnualFund.jsx` | 131 | Only named in a census script and a brand test |
| `client/src/components/Volunteers.jsx` | 118 | Replaced by `VolunteersHub.jsx` |
| `generate-favicons.js` + `generate-favicons.mjs` | 159 | Two copies of a one-off tool at the repo root |
| `client/src/components/HomeThankClock.jsx` | 87 | No reference |
| `client/src/lib/donorField.js` | 86 | No reference |
| `client/src/components/ProductMark.jsx` | 60 | Only named in a comment |
| `client/src/lib/safeHtml.js` | 40 | No reference |
| `.b73shot.js` | 24 | A stray screenshot script at the root |

The candidates that turned out to be live were `sources/*.js` (loaded by `readdir` in `sources/index.js`),
`BrandPanel.jsx` and `MediaLibrary.jsx` (`import.meta.glob`), `lostAndFoundWorker.js` (Web Worker),
`marketing/seo.js` and the prerender files (`client/scripts/prerender.mjs`), `giveMain.jsx`
(`give.html`) and `public/sw.js` / `public/embed.js` (served statically).

**Exports (980 exported names have no production caller outside their own file):**
- **757** are used inside their own file. The `export` is unnecessary but the code is live. This is low value; ignore it.
- **70** are used only by tests. They are kept exported so a suite can reach them, which is fine.
- **153** are referenced nowhere outside their definition. This is dead code (high confidence, spot-checked: 11 of 11 sampled had a single occurrence in the whole repo). Most are unused constants and helper variants in `shared/*Shape.js`, `formConfig.js`, `p2p.js` and `pricing.js`. The full list is at the end of this file.

### Feature flags and settings that never change

- **The source has no hard-coded boolean flags.** There is no `const X_ENABLED = true/false`, no `if (false)`, no `&& false`.
- **There are eight env switches.** Prod env values were not read (safety rule), so all that can be said is where each is set:

| Switch | Read in | Set anywhere in the repo? | Reading |
|---|---|---|---|
| `ORG_SUMMARY_OFF` | `orgSummary.js` | **Nowhere**: no doc, CI or test | Off unless someone set it on Railway by hand. Likely always off, so a removal candidate |
| `DRIFT_STORE_OFF` | `server.js` | Only described in `docs/decisions/home-and-reports.md` | A kill switch, probably always off |
| `DONOR_ACCOUNTS_ENABLED` | `server.js` | CI sets it to `1` | Whether prod has it on is for Jonathan to confirm |
| `NETWORK_SIGNUP_ENABLED` | `server.js` | CI sets it to `1` | As above |
| `INBOUND_EMAIL_ENABLED` | `server.js`, `routes/grantMail.js` | Tests, NEEDS-JONATHAN | Waiting on Jonathan per NEEDS-JONATHAN |
| `DISABLE_RATE_LIMIT`, `DISABLE_BACKGROUND_TICKS` | several | CI and tests | Test-only switches, correctly off in prod |
| `SETUP_SITE_ALLOW_LOCAL` | `setupSite.js` | Tests | Hard-gated off when `NODE_ENV=production` |

- **16 per-org `*_enabled` columns** live on orgs (`ai_enabled`, `emails_enabled`, `receipts_enabled`, `journey_enabled`, `qbo_sync_enabled`, `staff_mail_enabled` …). Whether any is uniform across all orgs can only be told from prod data, which this brief may not read. Next step: a read-only `SELECT col, count(*) GROUP BY col` run by Jonathan.
- **Hidden screens.** Donor Portal is hidden from the CRM ("hidden, never deleted") and Dashboards folded into Reports. `Dashboards.jsx` still ships through Reports, CallsToMake and SavedDashboards. These are kept on purpose, so they are not counted as dead.

### Routes the client never calls

**Method.** Every `router|app.METHOD("path"` in `server.js` and `routes/*.js` was listed (**1,426 routes**). For each route, the
static part of the path (up to the first `:param`) was searched for as a substring in `client/`, then in other
non-route code (emails, zapier, support, shared link builders), then in `tests/`. A substring match
is generous, so the true count of unused routes is **at least** what is shown here.

| Who calls it | Routes |
|---|---:|
| The client | 1,242 |
| Other code only (email links, webhooks from outside, zapier, public pages) | 139 |
| **Tests only** | **24** |
| **Nothing** | **21** |

Called by nothing:
`POST /help/tickets` (agent.js:1907), `POST /auctions/run-unpaid-sweep` (auctions.js:82),
`GET /auction/pay/:token` (auctions.js:633) and `POST /auction/pay/:token` (give.js:4046),
`POST /data-health/run` and `POST /data-health/proposals` (dataHealth.js:483, 526),
`GET /emails/journey/:draftId/as-sent` (emailsSent.js:169), `POST /qbo/read/auto/run` (finance.js:3843),
`GET /pos/attendance-drift` (give.js:309), `POST /connections/sweep` (give.js:1494),
`POST ${base}/undo` (removal.js:251; the path is templated, so this is probably a false positive),
`GET /stock-photos/thumb/:id` (stockPhotos.js:112),
`POST /volunteer/me/cancel`, `POST /volunteer/me/hours`, `GET|POST /volunteer/me/waiver`
(volunteerScheduling.js:987–1039), `GET|PATCH /volunteer-hub/settings` (volunteerScheduling.js:1511, 1523),
`POST /volunteer-hub/drafts/miss-you` (volunteerScheduling.js:2527),
`POST /admin/number-checks/run`, `POST /admin/status/run-checks` (server.js:3239, 3325).

Called by tests only:
`GET /agent/runs/:id`, `GET /agent/plans`, `POST /mailbox/run-replies`, `POST /billing/band/apply-now`,
`POST /board-pack/schedule/run`, `POST /journey-sends/run`, `POST /journeys/run-sweep`,
`POST /scores/recompute`, `POST /webhooks/deliveries/:id/resend`, `POST /qbo/auto-sync/run`,
`POST /xero/auto-sync/run`, `POST /pos/sales`, `GET /pos/buys-never-given`, `GET /pos/event/:id/revenue`,
`PUT /org-form/page/settings`, `GET /org-form/page/history`, `POST /org-form/page/history/:vid/restore`,
`POST /org-summary/check`, `GET /prospects/room-to-give`, `POST /volunteer-hub/magic-link`,
`POST /volunteer-hub/run-reminders`, `GET|POST /mailchimp/webhook/:secret` (called by Mailchimp, so
legitimate), `GET /why/questions`.

Many of the `…/run` routes are manual triggers for background jobs (ops or tests). They are not
dead. The volunteer self-service routes (`/volunteer/me/*`, hub settings) look like a half-built
feature with no screen.

---

## 4. Where the tests are and aren't

### Test lines per area

**Method.** Each of the 245 test code files was assigned to the area whose patterns (route paths and
module names) appear most often in its content. `tests/lib` counts as harness. Fixture JSON and CSV
are left out.

| Area | Test lines | Files |
|---|---:|---:|
| Money (gifts, pledges, recurring, Stripe, receipts) | 10,292 | 42 |
| Profile & people (donors, households, merge, delete) | 7,614 | 23 |
| Home, reports & numbers | 6,627 | 23 |
| Billing, signup & settings | 5,847 | 21 |
| Email & sending | 5,390 | 24 |
| Security & tenancy | 4,961 | 16 |
| Finance (ledger, funds, deposits, QBO/Xero) | 4,140 | 20 |
| Events, volunteers, members | 3,571 | 17 |
| Harness / unclassified | 2,917 | 24 |
| AI & agent | 2,650 | 14 |
| Imports | 1,631 | 7 |
| Smoke-walk, browser & meta guards | 826 | 8 |
| Grants & major gifts | 649 | 3 |
| **Total** | **57,115** | 245 |

Imports also leans on the **101,276 lines of real-shaped JSON and CSV fixtures**, and many import
cases are counted under "profile" because they assert on `/donors/` rows.

### How much of each route file the tests hit

This counts routes whose static path appears in some test.

| File | Routes hit / total |
|---|---|
| `routes/crm.js` | 424 / 561 |
| `routes/give.js` | 113 / 167 |
| `routes/finance.js` | 77 / 93 |
| `routes/billing.js` | 50 / 68 |
| `routes/volunteerScheduling.js` | 42 / 59 |
| `routes/agent.js` | 39 / 57 |
| `routes/dataHealth.js` | 24 / 41 |
| `routes/volunteer.js` | 19 / 31 |
| `routes/auctions.js` | 20 / 23 |
| `routes/mailTypes.js` | 15 / 18 |
| `routes/grantLibrary.js` | **7 / 20** |

### The 30 largest non-test files with no test that imports or exercises them

Every route file is hit by at least one test. The untested-by-name list is therefore all client
screens plus a handful of server modules.

**Client (only the smoke-walk opens them; no test imports or asserts on them):**
Settings.jsx 4,583 · DonorImport.jsx 4,559 · DonorProfile.jsx 4,112 · Dashboard.jsx 3,384 ·
Communications.jsx 2,438 · Donate.jsx 2,043 · Finance.jsx 2,008 · AdminDashboard.jsx 2,007 ·
Events.jsx 1,999 · shared.jsx 1,917 · Fundraising.jsx 1,550 · VolunteersHub.jsx 1,507 ·
PortalEditor.jsx 1,449 · JourneyBuilder.jsx 1,427 · Connections.jsx 1,250 · DonorDirectory.jsx 1,199 ·
App.jsx 1,182 · GivingDashboard.jsx 1,173 · MajorGifts.jsx 1,039 · MeetingPanels.jsx 954 ·
WelcomePage.jsx 948 · RecurringGiving.jsx 931 · Donors.jsx 919 · EmailEditor.jsx 875 · Reports.jsx 873 ·
WorkbookImport.jsx 867 · SpreadsheetImport.jsx 864.

**Server (no test imports them; reached only through routes):**
`qboSync.js` 847 · `why.js` 817 · `qboRead.js` 719 · `shared/formConfig.js` 696 ·
`shared/askCatalog.js` 692 · `donorList.js` 575 · `shared/emailBlocks.js` 557 · `reconcile.js` 527 ·
`shared/npspPreset.js` 510 · `shared/grantImport.js` 477 · `calendar.js` 453 ·
`shared/reportBuilder.js` 447 · `xeroSync.js` 444 · `shared/givingSources.js` 424 · `shared/oauth.js` 393.
`qboSync`/`xeroSync`/`qboRead` move money into books. `reconcile.js` runs inside `afterChange`. These
are the ones that matter.

### Areas only the smoke-walk touches

These are the client-side logic in DonorImport.jsx (field registry, auto-mapper, payload builders:
about 1,000 lines of pure functions that decide what gets sent to the import routes), Settings cards,
PortalEditor, JourneyBuilder, Donate.jsx display math (`grossUpWith`, `fmtAmt`: fee gross-up shown to
donors) and Finance.jsx monthly close. The smoke-walk proves these screens render. It does not prove
the numbers or payloads are right. The money-relevant ones are **DonorImport payload builders** and
**Donate.jsx gross-up**.

---

## 5. Where builds collide

**Method.** First-parent history of `main` over the last 60 days: 508 commits. Each commit was assigned to
its brief by the subject prefix (`FIX-55`, `HARDEN-2` …), and the distinct briefs per file were counted.
"Concurrent changes" counts the merge commits on any ref (234 in 60 days; 152 of them touched a file both
sides had changed) whose combined diff (`git log --cc`) lists the file. That means both branches had
changed it and the merge had to combine them, cleanly or by hand. A further 56 commit messages say
"conflict" outright.

| # | File | Briefs that changed it | Commits | Concurrent changes in merges | Named in a "conflict" message |
|---:|---|---:|---:|---:|---:|
| 1 | `docs/HISTORY.md` | 161 | 188 | 53 | 24 |
| 2 | `tests/run-all.sh` | 148 | 248 | 50 | 14 |
| 3 | `db.js` | 140 | 215 | 47 | 3 |
| 4 | `audit/route-inventory.json` | 139 | 218 | 39 | 17 |
| 5 | `server.js` | 135 | 263 | 49 | 6 |
| 6 | `routes/crm.js` | 112 | 146 | **84** | — |
| 7 | `audit/suite-timings.json` | 83 | 119 | — | 7 |
| 8 | `client/src/components/Dashboard.jsx` | 74 | 101 | 20 | — |
| 9 | `client/src/components/Settings.jsx` | 67 | 89 | 15 | 2 |
| 10 | `tests/script-guards.test.js` | 59 | 94 | — | — |
| 11 | `client/src/components/DonorProfile.jsx` | 57 | 73 | 22 | — |
| 12 | `client/src/components/Donors.jsx` | 54 | 98 | 10 | — |
| 13 | `client/src/App.jsx` | 53 | 67 | 11 | 2 |
| 14 | `scripts/seed-demo.js` | 50 | 79 | — | — |
| 15 | `figureSources.js` | 48 | 56 | 7 | — |
| 16 | `routes/finance.js` | 48 | 52 | 12 | — |
| 17 | `tests/tenant-matrix.test.js` | 47 | 76 | 6 | 2 |
| 18 | `NEEDS-JONATHAN.md` | 47 | 55 | — | — |
| 19 | `routes/give.js` | 44 | 55 | 8 | — |
| 20 | `client/src/components/Communications.jsx` | 42 | 48 | 7 | — |

"—" means it was not in the top-30 of that column. Other files that collide often in merges but change less: `tests/smoke-walk.test.js` (17),
`routes/sheetImport.js` (14), `client/src/components/shared.jsx` (13), `SpreadsheetImport.jsx` (11).

**What causes it.** Five of the top six are **append points every build has to touch**: the HISTORY
entry at the top of one file, the suite list in `run-all.sh`, a schema block in `db.js`, the
regenerated route inventory, and the mount/job in `server.js`. `routes/crm.js` collides most in
merges because 18 domains share one file.

---

## Appendix: the 153 dead exports, by file

- `apiCheck.js`: `isNoAnswer`
- `askEngine.js`: `cellMeasure`
- `assetStore.js`: `restoreAsset`, `_signedS3Request`
- `auctionCore.js`: `SYS_PAY`
- `capture.js`: `storeFile`, `LOW_KINDS`
- `client/src/api.js`: `forgetReads`
- `client/src/components/HomeThankClock.jsx`: `HomeThankClock`
- `client/src/components/Insights.jsx`: `ProfileLadder`
- `client/src/components/Linked.jsx`: `LINK_EMERALD`
- `client/src/components/NavIcon.jsx`: `hasNavIcon`
- `client/src/components/shared.jsx`: `retentionRisk`
- `client/src/components/VolunteerBlocks.jsx`: `VOLUNTEER_BLOCK_TYPES`
- `client/src/components/WhyAnswer.jsx`: `ShowMeLine`
- `client/src/lib/dirtyGuard.js`: `anyDirty`
- `client/src/lib/donorField.js`: `STEADY_COUNT`, `fieldDots`, `breatheDelay`
- `client/src/lib/entitlement.js`: `planKnown`
- `client/src/lib/majorGifts.js`: `ROOM_RANK`
- `client/src/lib/morningSentence.js`: `morningSentence`
- `client/src/lib/planNames.js`: `planDisplayLine`
- `client/src/lib/portalScrim.js`: `textContrastOverPixel`
- `client/src/lib/safeHtml.js`: `safeHtml`
- `client/src/marketing/data/features.js`: `FEATURE_CATS`, `FEATURE_EXTRAS`
- `client/src/marketing/data/messaging.js`: `HOW_INTRO`, `NEVER_SENDS`
- `client/src/marketing/lib.jsx`: `Shot`, `ReadyPair`, `LeadBand`
- `donorTags.js`: `internalTags`
- `insights.js`: `RUNGS`
- `itemRefs.js`: `personRef`
- `jobQueue.js`: `_busy`
- `lapseRule.js`: `lapsedOn`, `lapsingOn`
- `mailboxFetch.js`: `GMAIL_MIN_CHUNK`
- `mailRefusal.js`: `HARD_BOUNCE_REASONS`
- `meetings.js`: `lastConversationWith`
- `middleware/auditTrail.js`: `tableFor`
- `money.js`: `fromDollars`
- `orgTime.js`: `FISCAL_START_MONTH`
- `personPhoto.js`: `initialsFor`, `_photoSignature`
- `pictures.js`: `MAX_UPLOAD_MB`
- `pricing.js`: `amountUsdFor`, `allPriceEnvNames`
- `sampleData.js`: `CASCADE_HANDLED`
- `setupSite.js`: `mergeSite`
- `shared/agentShape.js`: `AUTHORIZATIONS`, `TOOL_NAMES`, `withheldSentence`, `planNeedsReshowing`
- `shared/askCatalog.js`: `DIMENSION_KEYS`
- `shared/boardPack.js`: `packSectionByKey`, `packFigureDefs`
- `shared/briefShape.js`: `CITE_KINDS`, `schemaForbiddenKeys`
- `shared/campaignKind.js`: `EMAIL_STATUSES`
- `shared/dashboards.js`: `DASHBOARD_KEYS`, `allMetrics`, `DEFINITION_RULES`
- `shared/depositSheet.js`: `DEPOSIT_STATES`
- `shared/draftNote.js`: `letterMoney`
- `shared/emailTemplateLibrary.js`: `STARTER_KEYS`
- `shared/employerMatch.js`: `registerLookupProvider`, `lookupProviderKeys`, `resolveEmployerMatch`
- `shared/eventShape.js`: `QPQ_DISCLOSURE`
- `shared/formConfig.js`: `specFingerprint`, `designationBlurb`, `FUNNEL_METRIC_KEYS`, `funnelDefinition`, `funnelDefinitionProblems`, `AB_VARIANTS`
- `shared/giftCredit.js`: `SOFT_CREDIT_ROLE_LABELS`
- `shared/giftFooting.js`: `FOOTING_DEFINITIONS`, `footingLine`
- `shared/givingPageDesign.js`: `WAY_KEYS`
- `shared/givingSources.js`: `API_PROVIDERS`, `ROW_FIELDS`, `FORBIDDEN_FRESHNESS_WORDS`
- `shared/grantImport.js`: `fieldForHeader`
- `shared/grantMilestones.js`: `shiftDays`
- `shared/grantOutline.js`: `sectionsWithoutSource`
- `shared/grantShape.js`: `restrictionLabel`, `isRestricted`
- `shared/greeting.js`: `dearLine`
- `shared/homeNote.js`: `BANNED_PUNCTUATION`
- `shared/importSentence.js`: `DECISION_KINDS`
- `shared/importShape.js`: `headerHasQualifier`, `headerHasMoneyWord`, `giftCreditFromRow`
- `shared/itemLinks.js`: `linkedHtml`
- `shared/journeyShape.js`: `hoursMilestoneCrossed`, `AUDIENCE_KEYS`, `PRESET_STARTERS`, `stepPositionSentence`
- `shared/legalEntity.js`: `LEGAL_ENTITY_STATE_LONG`, `operatedByLine`
- `shared/mailchimpPreset.js`: `mailchimpMapping`, `MAILCHIMP_CUSTOM_FIELDS`
- `shared/majorGiftsDash.js`: `METRIC_IDS`
- `shared/membership.js`: `CURRENT_STATUSES`, `inRenewalWindow`
- `shared/membershipImport.js`: `MEMBERSHIP_PRESET_KEYS`
- `shared/movePlan.js`: `moveCardSentence`
- `shared/npspPreset.js`: `npspOrganizationName`, `NPSP_STAGE_PROPOSAL`, `NPSP_DEFAULT_STAGES`
- `shared/numberCensus.js`: `censusFor`, `sentenceProblems`
- `shared/p2p.js`: `TEAM_STATUSES`, `MAX_STORY`, `SOFT_CREDIT_SENTENCE`, `FUNDRAISER_STATUSES`
- `shared/pageWidgets.js`: `widgetDef`, `isFullWidth`, `FORM_POSITION_LABEL`
- `shared/payoutReconcile.js`: `centsToDollarsText`
- `shared/personType.js`: `addType`
- `shared/planShape.js`: `STEP_STATUSES`, `PLAN_ACTIVE`, `PLAN_DONE`, `PLAN_ABANDONED`, `planIsFinished`
- `shared/posItems.js`: `MATCH_ORDER`
- `shared/processingRates.js`: `NONPROFIT_CARD_RATE`, `rateKindForMethod`, `coveredAmountCents`
- `shared/proposalShape.js`: `conflictRefusal`
- `shared/publicSources.js`: `DIRECT_HEADING`, `UPLOAD_HEADING`, `allowedDirectNames`, `uploadNames`
- `shared/reportBuilder.js`: `STANDARD_KEYS`
- `shared/restrictedMoney.js`: `RESTRICTED_METRIC_KEYS`, `metricDefinition`
- `shared/secretBox.js`: `isSealed`
- `shared/sequenceShape.js`: `trackRuleSentence`
- `shared/sheetRead.js`: `mapMethodWord`
- `shared/smartAmounts.js`: `HOW_CHOSEN`
- `shared/sourcePresets.js`: `presetSentence`, `statementExternalId`
- `shared/stockPhotos.js`: `stockForNewBlock`
- `shared/threadShape.js`: `TIMED_STEPS_IGNORE_WEEKEND_TOGGLE`
- `shared/vocabulary.js`: `seasonDaysAway`
- `shared/volunteerShifts.js`: `SIGNUP_STATUSES`, `OPEN_STATUSES`, `milestoneSentence`
- `twoFactor.js`: `sessionAlive`
