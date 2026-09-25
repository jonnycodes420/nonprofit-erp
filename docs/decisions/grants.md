# Grants

Read this when you touch funders, grant deadlines, documents, restricted money, grant reports or grant import.

## Rules
- **Use the six canonical grant statuses and never add a second `grant_stage` column.** researching ·
  loi · submitted · awarded · declined · closed; every older spelling is an alias resolved only in
  `normalizeStatus` (shared/grantShape.js), and a status filter must match the aliases too. (BUILD-100 grants)
- **A grant is a request to an institution; refuse a person as a funder.** `funderProblem` says why at
  every door: an individual's cheque is a gift, and filing it as a grant puts it in the wrong half of
  every report. (BUILD-100 grants)
- **Refuse time-restricted money that has no release date.** Restriction is one of unrestricted ·
  program-restricted · capital · time-restricted, and for time-restricted the date is the restriction. (BUILD-100 grants)
- **Record a decline with a reason from the closed list.** When an import carries no readable reason,
  write `other` plus the note, never `no_reason_given`: that key claims the funder said nothing. (BUILD-100 grants)
- **An award via `PUT /grants/:id/award` writes exactly one pledge on the funder and no gift.**
  Instalments go through `writePledgeInstallments` so the cheque applies itself from any door; a second
  press writes nothing (`award_pledge_id`); the grant must be linked to a funder record first. (BUILD-100 grants)
- **The general `PUT /grants/:id` award books the ledger exactly once through `stampGrantAward`.**
  `uq_fin_txns_grant` + ON CONFLICT DO NOTHING; un-award deletes the auto stamp and unlinks an adopted
  manual row (`grant_id=NULL`) without deleting it. (Finance entity-routing FIX)
- **Money from a funder enters through the gift or grant paths; Finance's manual money-in is for
  non-donor revenue.** The form routes an open-ask name to the award flow and a known donor to a gift
  (`client/src/lib/financeMatch.js`; ambiguous = no match). (Finance entity-routing FIX)
- **Check for an existing manual row before every client award.** `resolveAwardAdoption` (Grants.jsx)
  calls `GET /grants/:id/manual-match` and offers `adoptTxnId`, so a treasurer's row becomes the award's
  booking instead of a second one. (Finance entity-routing FIX)
- **`awarded_at` is the attribution fact, and an award never creates a gift row.** It is set entering
  awarded, kept through closed, cleared on un-award; attributed awards count in `raised` as `grantAwarded`. (Attribution FIX)
- **Sum grant money in integer cents.** `grants.amount`/`received` are NUMERIC and come back as strings,
  so `0 + "5000.00"` concatenates without throwing; the client sums through `client/src/api.js`. (BUILD-100 grants)
- **A deadline is a milestone Steward watches, not a date on a row.** Five kinds with per-org lead days
  (`orgs.grant_lead_days`); inside its lead it becomes a Thread on the funder, owned by the grant's
  officer and due on the milestone's date (shared/grantMilestones.js). (BUILD-100 grants)
- **Keep the milestone's three states (pending, waiting, raised).** `threads_one_open` makes a milestone
  WAIT behind an open thread; the sweep re-reads pending and waiting every pass, so it self-heals with no
  tick, and `waitingSentence` explains the wait. (BUILD-100 grants)
- **Moving a deadline moves its thread.** Set `original_due_date = COALESCE(original_due_date, due_date)`
  (the snooze semantics). (BUILD-100 grants)
- **Merge a lead-times save as `{...stored, ...pickLeadDays(patch)}`.** `normalizeLeadDays` fills from
  DEFAULTS, so a refused value would reset the org's own choice. (BUILD-100 grants)
- **Count upcoming deadlines only through `deadlinesInWindow`.** Home's `grantDeadlinesSoon`, the
  Deadlines screen and the old line share it; Home says it as `homeNote.grantDeadlineSentence`, never
  the numeral `homeDeadlineLine`. (BUILD-100 grants Part 7)
- **Show deadline urgency only while the grant is still being pursued.** Awarded and closed grants never
  read Overdue; `deadlineMeta()` in Grants.jsx is the one implementation. (BUILD-33)
- **Serve grant files through their own signer (grantDocs.js), never the photo signer.** The kind is
  inside the HMAC, links last 30 minutes, attachment-only + nosniff, and the first bytes decide the type
  (no svg, no html). (BUILD-100 grants)
- **Move the 20 MB document cap and the 30mb body parser together.** They are one decision in two places;
  moving one alone surfaces as a bare 500 PayloadTooLargeError. (BUILD-100 grants)
- **Derive document versions from upload order, never a stored column.** (BUILD-100 grants)
- **Any table that references assets must be in `collectLiveAssetRefs` (assetStore.js).** Without
  `grant_documents` there, the 90-day sweep destroys a signed agreement. (BUILD-100 grants)
- **Give every bare-path link route a vercel.json rewrite.** A signed document opens with no auth header,
  so an unproxied path returns index.html in prod; `tests/email-links.test.js` §4b derives the list from
  unauthenticated `app.get("/seg/:param"` routes. (BUILD-100 grants Part 7)
- **Restricted `remaining` is received minus spent.** Promised-but-unpaid money is `outstanding`, its own
  line; overspent is said out loud, never clamped to zero (shared/restrictedMoney.js). (BUILD-100 grants)
- **A payment against a restricted award posts to the grant's fund inside `recordGift`.** It runs before
  the unrestricted fallback, so restricted revenue lands restricted from every door. (BUILD-100 grants)
- **Render an overspent balance sign-first ("-$5,500") at the render site, keeping `{fmtFull(` inline.**
  `fmtFull` gives "$-4,200" by design, and a wrapper hides the figure from the number census. Each
  figure's hover is its `RESTRICTED_METRICS` definition. (BUILD-100 grants Part 7)
- **Computed grant reports call the screens' own functions, never a second query.** grant-deadlines-90
  and grant-restricted-balances are handlers over Part 2's and Part 4's functions. (BUILD-100 grants)
- **Keep numeric fields out of the grant report outline (shared/grantOutline.js).** Steward renders every
  figure; an outcome claim is refused whatever it cites; a document row says Steward has NOT read the
  file; figures are stored at draft time, not recomputed. (BUILD-100 grants)
- **Import grants as a preset on the one mapper (shared/grantImport.js), never a second importer.** A name
  match may not land on a person: that row is refused by line with nothing written. (BUILD-100 grants)
- **Match funders by EIN before name, and keep the entity type in the name key.** `donors.funder_ein`
  has a partial unique index; "Sunrise Foundation" and "Sunrise Trust" are two funders. A 409
  `ein_already_on_file` is a merge and is said as one. (BUILD-100 grants)
- **An imported grant file is history and raises nothing.** No gift, pledge, watched deadline or
  follow-up; an awarded row gets no pledge because its cheques already came. (BUILD-100 grants)
- **Let the matched header spelling decide what an amount means.** "Amount Requested" on an awarded row
  demotes it to submitted; a plain "Amount" on Closed Won is the award. Each vendor preset is detected
  from two of its own columns. (BUILD-100 grants)
- **Check contrast in a browser when reusing a component on the dark rail.** `TouchpointTimeline` draws
  in ink for light surfaces; on GrantProfile's rail the notes were unreadable while every assertion
  passed (tests/build99-grant-timeline.test.js). (BUILD-99 grant-timeline fix)

## Gotchas
- **pg returns `timestamptz` as a JS Date, and `String(date)` sorts by weekday name.** Normalise to ISO
  in one place before sorting or numbering versions. (BUILD-100 grants)
- **`threads` has no `updated_at`.** Writing one 500s the route and leaves the thread pointing at the
  old deadline. (BUILD-100 grants)
- **A write route must read a key only when it is present.** `PUT /funders/:donorId` once refused an
  EIN-only body over an absent `funderType`. (BUILD-100 grants)
- **`PUT /grants/:id` requires the full body (`funder` is required).** A status-only PUT 400s; use
  `/grants/:id/award` or `/decline` for those moves. (BUILD-44)
- **Two award doors do different things.** The general PUT stamps the ledger; `/award` writes the
  funder pledge. Know which one a new surface calls before adding a third booking. (BUILD-100 grants)
- **A `shared/` module the server dynamic-imports stays stale until the server reboots.** Restart
  before proving a guard can fail, or the planted defect runs green. (BUILD-100 grants)
- **Requiring `assetStore.js` in a test opens a second pg pool with no SSL config.** Drive the real
  purge route instead. (BUILD-100 grants)
- **New grant child tables need tenant-matrix entries.** Add `bResolver` ids (`msId`, `docId`,
  `spendId`) and put `grant_spend`/`grant_milestones`/`grant_documents` in the reset list BEFORE
  `grants`, since `grant_id` is nullable. (BUILD-100 grants)
- **`testMode` is a function in server.js, not a const.** (BUILD-100 grants)
- **A literal control-character regex in a command makes the Bash tool refuse it.** Keep `\x00-\x1f`
  in source files, not in shell strings. (BUILD-100 grants)

## Where the code is
- `shared/grantShape.js` — statuses and aliases, restriction kinds, decline reasons, `funderProblem`, `validateGrant`
- `shared/grantMilestones.js` — milestone kinds, lead days, `pickLeadDays`, `deadlinesInWindow`, `waitingSentence`
- `shared/restrictedMoney.js` — `grantBalance`, `RESTRICTED_METRICS` definitions, spend validation
- `shared/grantOutline.js` — the report outline schema and its claim refusals
- `shared/grantImport.js` — the grant import preset, name keys, vendor presets
- `grantDocs.js` — the grant-document signer and type sniffing
- `server.js` `stampGrantAward`, `PUT /grants/:id/award`, `PUT /grants/:id/decline`, `GET /grants/:id/manual-match`
- `client/src/components/Grants.jsx` — GrantProfile, `deadlineMeta`, `resolveAwardAdoption`
- `client/src/components/GrantDeadlines.jsx`, `GrantDocuments.jsx`, `FunderPanel.jsx`, `RestrictedView.jsx`, `GrantImport.jsx` — the grant screens
- `client/src/lib/financeMatch.js` — `namesMatch`, `findOpenGrantMatch` for Finance routing
