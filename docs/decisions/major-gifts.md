# Major gifts and the pipeline

Read this when you touch the pipeline, stage or status, moves, opportunities, portfolios and assignment, or wealth scoring.

## Rules
- **Assignment to an officer IS portfolio membership IS a place on their board; add no second flag.**
  `donors.in_pipeline` is retired and read by nothing. Unassigned donors live in the Directory only. (BUILD-30)
- **Count portfolio and pipeline membership only through `portfolioMembership()` (server.js).**
  It means assigned plus a pipeline stage, and it feeds Home's Portfolio and Pipeline cards, the board
  and the officer legend, so all four are one number. (BUILD-30)
- **A portfolio or pipeline card must open a view showing exactly its number, on the same scope.**
  Home's cards thread `scope` into `Pipeline`'s `initialScope`. (BUILD-30)
- **Handle a big portfolio with the column cap, search and filters, never by hiding people.**
  The board caps each column server-side and the client shows 30 cards with "Show more". (BUILD-30)
- **An import fills the Directory, never the board.** Owner routing is Team-only: officers are matched by
  email, then name (`matchOwnersToUsers`); an ambiguous match is left unassigned, never guessed.
  (Import-assign FIX 2026-07-28)
- **Hold a donor assigned to a pending invitee, don't drop it.** The id `invite:<id>` sets
  `pending_assignee_invite_id`, off every board until `/auth/invite/accept` turns it into real
  assignment. This covers import and bulk assign alike. (Import-assign FIX, BUILD-36)
- **Seeing other officers' portfolios is admin-only, and the server enforces it.** For a non-admin,
  `GET /pipeline` downgrades `scope=all` to `mine` and clears a foreign `assignedTo`. Bulk
  "Assign owner" is admin-only too. (BUILD-31, BUILD-36)
- **Donor data is shared across the org; only portfolio VIEWS are scoped to the officer.** Never
  silo notes per officer. Any colleague may clear a drift item, and the actor stamp records who. (BUILD-76)
- **Show the My/All portfolio toggle and the officer filter only when `multiOfficer` is true.** That
  means two or more officers hold assigned donors. (BUILD-32)
- **Gate every major-gifts write with `requirePlan('team')` and then `checkWriteAccess`, and leave the
  reads open.** This covers stage, bulk-stage, assign, bulk-assign, score, move, opportunity and proposal
  writes. Core sees its own data behind glass. (BUILD-20, BUILD-45)
- **Keep the pipeline stage set fixed.** It is the one `donors.stage` enum used app-wide. Build no
  per-org stage editor without new direction. (BUILD-15)
- **Log every managed stage change as a move with a required description.** `POST /pipeline/:donorId/move`
  writes a `moves` row plus a `stage_change` interaction. A board drag prompts for the note and never
  saves an empty move. (BUILD-15, BUILD-30)
- **The officer owns stage: Steward suggests and never auto-advances, except for Lapsed.**
  `autoLapseOrg` skips donors with no prior giving, those at `solicit`, those with an open ask, and those
  an officer moved forward since their last gift. (BUILD-22)
- **Every gift door that can re-engage a lapsed donor calls `autoUnlapseOnGift`, which moves them to Steward.**
  `recordAutoMove` logs every automatic move with a null officer and an `Auto:` description, so nothing moves
  silently. (BUILD-22)
- **Suggestions (`computeMoveSuggestions`) are read-only.** Reading them never changes a stage or writes a
  move. Accept goes through the normal move route. (BUILD-22)
- **A proposal is a row in `opportunities`; add no `proposals` table.** A person sets `proposal_stage`.
  `status` is derived only by `statusForStage` (shared/proposalShape.js), so no code path writes one
  without the other. (BUILD-99 major gifts)
- **Allow one open proposal per fund per HOUSEHOLD, enforced by `INSERT … WHERE NOT EXISTS`.**
  `opportunities_one_open_per_fund` is only attempted and names colliders in the boot log; a bare unique
  index would stop boot on an existing duplicate. (BUILD-99 major gifts)
- **Probability is picked from 10/25/50/75/90, and any other value is refused, not rounded.** The
  weighted total counts only proposals that carry a probability she set, and it says how many it left out.
  (BUILD-99 major gifts)
- **Decline reasons for proposals are a closed list.** "Why do we lose asks" must be countable.
  (BUILD-99 major gifts)
- **Order a portfolio by open ask, then days since last contact.** "Never spoken to" sorts above any
  silence (`rankPortfolio`). A target or cap is hers: absent until she types it. A cap blocks nothing.
  (BUILD-99 major gifts)
- **`PATCH /donors/:id/assign` validates the officer's org, reads the name from `users`, and records
  the actor.** Never take the owner's name from the payload. (BUILD-99 major gifts)
- **"Major prospect" means `orgs.major_prospect_cents` (default $1,000), and the sentence quotes it.**
  (BUILD-99 major gifts)
- **A cultivation plan is a sequence of Threads and it sends nothing.** Only one step is open, enforced by
  `cult_step_one_open`. Steps chain with no tick. A skip is recorded as SKIPPED with a reason. Editing a
  template never rewrites an applied plan, and deleting a template archives it. (BUILD-99 major gifts)
- **A plan template may only use step types the Thread engine knows, and may never go back in time.**
  This is asserted against the engine's own table (shared/planShape.js). (BUILD-99 major gifts)
- **The prospect brief has no numeric field.** Steward renders every figure from the rows. A sentence
  that cites no row it was given is dropped and counted. Numeric rules go through `shared/thresholds.js`.
  Capacity language is refused even with no digit in it (shared/briefShape.js). (BUILD-99 major gifts)
- **The major-gifts dashboard invents no goal and no benchmark.** Each tile's definition is the
  registry's own string. Asked-versus-committed is a plain fraction, never a "close rate"
  (shared/majorGiftsDash.js). (BUILD-99 major gifts)
- **An officer's win rate is won ÷ (won + lost) over decided asks only.** Open asks are not losses.
  (BUILD-33)
- **An open ask is not a gift.** An ask/proposal column must say ASK, PROPOSAL, OPPORTUNITY or SOLICITATION,
  so a bare "Amount" never counts. An open NPSP Opportunity becomes a proposal. Closed Won is a gift.
  Closed Lost is refused. `importProposals` touches no money. (BUILD-99 major gifts)
- **Never render "Wealth Score".** The figure is "Giving strength", defined by `numberCensus`
  `list.givingStrength` (not an estimate of capacity). The filter is "Proven capacity". A model is never
  asked to emit a score. (BUILD-100 score-names)
- **Keep the profile's wealth score hidden until `WEALTH_SCORE_DEFINITION` and `WEALTH_SCORE_SOURCE`
  (Donors.jsx) carry real strings.** Nothing may put an undefined number beside a person's name. (BUILD-88a)
- **An imported wealth screen (DonorSearch/iWave) keeps the vendor's text and never feeds `wealth_score`.**
  It lands in `donors.wealth_screen_*`. A bare "Score" or "Rating" header is not claimed. (BUILD-98 switch Part 6)

## Gotchas
- **Two "weighted" figures exist, so keep them separate.** The board's `forecast.weighted` is ask ×
  `STAGE_WEIGHT[donor.stage]`. The proposals total uses only the probabilities she set. (BUILD-15, BUILD-99 major gifts)
- **`donors.stage` and `opportunities.proposal_stage` are different vocabularies.** prospect…lapsed is
  the person's pipeline. identified…stewarding is one ask. (BUILD-99 major gifts)
- **`PATCH /donors/:id/stage` writes no `moves` row.** Use `POST /pipeline/:donorId/move` for any
  change that officer reports must count. (BUILD-15)
- **Check the donor (404) before the AI gate on per-donor AI routes.** `POST /donors/:id/brief` once
  answered a cross-tenant probe with 503. tenant-matrix §3 catches this. (BUILD-99 major gifts)
- **A backtick inside a template-literal SQL comment ends the literal.** The error points at the
  opening line. (BUILD-99 major gifts)
- **Cast every placeholder in `INSERT … SELECT ?,?`**, including one used only in `IS NOT NULL`, because
  there is no type context for it. (BUILD-99 major gifts)
- **A pg `DATE` comes back as a JS Date at LOCAL midnight.** `String(d).slice(0,10)` gives "Sun Nov 15"
  and `toISOString()` shifts the day. Read the local calendar parts instead. (BUILD-99 major gifts)
- **`normalizeDate` returns `{value, warn}`, not a string.** (BUILD-99 major gifts)
- **A raw-byte search of a pdfkit PDF finds nothing, because it is Flate-compressed.** Inflate the streams, and
  never write an assertion with an `|| true` escape. (BUILD-99 major gifts)
- **$0 pipeline tiles with zero opportunities are correct.** Read the rows before blaming the rollup.
  (BUILD-45)

## Where the code is
- `server.js` `portfolioMembership` — the one portfolio/board/Home membership definition
- `server.js` `autoLapseOrg` / `processSmartMoves` / `autoUnlapseOnGift` / `recordAutoMove` / `computeMoveSuggestions` — lapse and suggestions
- `server.js` `recordMove`, `POST /pipeline/:donorId/move`, `GET /pipeline` — moves and the board
- `server.js` `buildAssigneeResolver` — import assignment, including pending invitees
- `server.js` `importProposals` — post-commit proposal import
- `shared/proposalShape.js` — `PROPOSAL_STAGES`, `statusForStage`, probabilities
- `shared/portfolioShape.js` — `rankPortfolio`, target and cap sentences
- `shared/planShape.js` — cultivation templates and step chaining
- `shared/briefShape.js` + `shared/thresholds.js` — the brief's citation and claim rules
- `shared/majorGiftsDash.js` — dashboard tiles and their definitions
- `shared/importShape.js` — `detectOwnerColumn`, `matchOwnersToUsers`, `groupOwnerMatches`, `WEALTH_HDR`
- `client/src/components/MajorGifts.jsx` — proposals, portfolio, plans, brief, dashboard; `Pipeline.jsx` — the board
- `scripts/build99-brief-drill.js` — the manual real-model brief drill (not in the battery)

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Status vs stage, and stage inference (moved from the old CRITICAL WORKING RULES)

- IMPORTANT donor table distinction: there are TWO separate columns: `status` (giving-tier: new/mid/major/lapsed) and `stage` (pipeline: prospect/qualify/cultivate/solicit/steward/lapsed). The UI Kanban/Directory pipeline views read `stage`; giving-tier/retention logic reads `status`. They are NOT the same and must not be conflated.
- **inferStage (Donors.jsx, the SINGLE stage-inference definition)** maps giving history → stage: no gift + email/phone on file → `qualify`, no gift + no contact → `prospect`, last gift <90d (amount>0) → `steward`, a $1000+ gift 90–180d ago → `solicit`, any other prior gift → `cultivate`, last gift >365d → `lapsed`. The 365-day lapse boundary is the SAME `LAPSE_DAYS` used by BUILD-22 auto-lapse + the pipeline "Lapsed" column — do NOT fork a second lapse/inference rule. (Older docs said inferStage "never produces qualify or solicit" — that was a prior version; it now does, and the server import SQL mirrors these exact bands.)
- **Import infers initial stage via inferStage** (a spreadsheet rarely has a stage column). Explicit stage column ALWAYS wins (`normalizeStage` on the client, `_stageExplicit` flag → server skips re-inference). Donor-only import (`/donors/import`) infers client-side from the aggregate total/last-gift columns; the two history paths infer server-side AFTER gifts load + `recalcDonorSummary`: `/donors/import-combined` re-infers all gift-donors (except `_stageExplicit`) from the recalculated rows, and `/gifts/import-history` advances only donors still at `prospect` (so adding history later stages them without clobbering a human-set stage). Import preview shows the inferred stage; editable anytime after. Not plan-gated (a data operation, not a Team feature). Guarded by `tests/import-stage.test.js`.

## Database tables (moved from the old "Database — key tables and columns")

### MGO toolkit tables
- `planned_gifts` — id, org_id, donor_id, type (bequest/charitable_remainder_trust/charitable_lead_trust/annuity/ira_beneficiary/life_insurance/real_estate/other), estimated_value, date_indicated, notes, created_at
- `donor_materials` — id, org_id, donor_id, file_name, file_type, file_url, file_data (base64 <1MB), notes, uploaded_by, uploaded_at. `donor_materials` and `planned_gifts` were missing from the org-deletion cascade (`DELETE /admin/orgs/:id`) — fixed to delete both (and `milestone_drafts`, `note_reminders`) BEFORE `donors`, since they carry `donor_id` FKs. See "Admin data integrity" below.

### MGO backend routes
- `GET /dashboard/my-stats` — 6 FY metrics for current user (portfolioCount, visitsYtd, madeYtd, giftsYtd, pipelineValue, lapsedCount); fiscal year July 1–June 30
- `GET /donors/:id/fund-affinity` — gifts grouped by fund_id with totals, counts, last dates, percentages; includes activeFunds for suggested asks
- `PUT /campaigns/:id/briefing` — save briefing, goal_amount, start_date, end_date (any campaign status)
- `GET /campaigns/:id/progress` — goal, raised (sum from gifts), donorCount, daysRemaining
- `PUT /gifts/:id`, `DELETE /gifts/:id` — inline gift editing/deletion. DELETE handles the gift's legal/financial references deliberately (2026-07-16, was an unhandled FK violation): an **active tax receipt blocks deletion with 409** `receipt_active` ("void the receipt first" — receipts are legal artifacts, silent cascade is wrong); voided receipts get `gift_id` NULLed (their frozen `snapshot`/`pdf_data` record survives); a pledge fulfilled by the gift is reopened (`status='open'`, fulfilled fields cleared). All in one transaction before the delete + donor recalc.
- `GET/POST /donors/:id/planned-gifts`, `PUT/DELETE /planned-gifts/:id` — planned giving CRUD
- `GET/POST /donors/:id/materials`, `DELETE /materials/:id` — donor materials CRUD
