# Imports

Read this when you touch file import (CSV, xlsx, workbooks), shape detection, the column mapper, money or date parsing, dedupe on import, exclusions, or export files.

## Rules
- **Who a row or a check is from is `donorMatch.js`'s answer (CHECK-2).** `matchDonor(orgId, { name | names,
  email, line1, postal })` returns matched (with the reasons and history in one sentence), choices, or none.
  Signals in order: email; every name on it against records of the SAME last name only (same first name with
  or without a middle initial, a nickname, or a first initial that points at one person; a different middle
  initial is somebody else; a first name alone never matches); the spouse on file or a household member for a
  joint name; the street number and street, or the ZIP. None is never a silent new person: a person chooses
  "New donor". IMPORT-3 and capture call this; do not write a second matcher. `properCase` is for names read
  off paper in capitals only; a name a person typed keeps its capitals.
- **An old spreadsheet comes in through one door (SHEETS-1).** `POST /sheets/read` says what a sheet is
  and writes nothing: grants (a funder column and an amount column, read by shared/grantImport.js) or a
  table of numbers (a column mostly numbers). Neither is refused, never guessed. Grants go through
  `POST /grants/import`, the one grant importer, which keeps the file and every unplaced column's values
  line by line in `stored_sheets`; the file is checked before anything is written. A board report keeps
  its table exactly and its file (`stored_sheets.asset_id`, in `collectLiveAssetRefs`).
- **Build every vendor or statement format as a preset on the one mapper, never as a second importer.**
  Presets live in `shared/*Preset(s).js`, `grantImport.js` and `membershipImport.js`. (BUILD-89S, BUILD-98)
- **Let a preset claim a file only when two of its own signal columns are present.** A tie is a question
  for the person, not a guess. Every preset stays "documented-not-walked" until a real export is checked. (BUILD-98)
- **Split a header into tokens before matching it** (`normalizeHeader`/`headerTokens`). Never run `\b` over
  a raw header, because `_` is a word character and `\bzip\b` misses `zipcode`. (BUILD-84)
- **Match a header as a whole header, never by substring**: exact, a trailing word-run, or a leading run
  that is not followed by a qualifier (code, confidence, score, estimate, band, tier). (BUILD-83, BUILD-84)
- **Do not treat a numeric column as money.** A column is money only when at least 20% of its cells carry
  a currency mark or its header has a money word, and never when it has a measurement qualifier.
  `amountColumnEvidence` makes the call. (BUILD-84)
- **Report each money column with its own subtotal and reason, and never merge them into one total.**
  `inFile` stays null unless a single column is unambiguous. (BUILD-84)
- **A row can be named by a person's name, an email or an organisation.** `resolveDonorIdentity` is the
  only test, and every path calls it. A row that fails it is set aside with the `NAMEABILITY_REASON` string. (BUILD-84)
- **Never drop input silently.** Every column is mapped, deliberately ignored or unrecognised
  (`classifyColumns`), and each set-aside row is listed by line number with its reason. (BUILD-58, BUILD-78)
- **Balance the column axis.** Columns counted at parse (`countPhysicalColumns`) must equal the disposition
  ledger (core, custom-existing, custom-new, flag, discarded, refused), or import-combined answers 409. (BUILD-78)
- **Send exclusion-shaped columns (deceased, do not contact, remove from appeals) to the core flag family,
  never to a custom field.** (BUILD-78)
- **Every custom-field write goes through `validateCustomFields`.** Type rules live only in
  `shared/customFieldShape.js`, values are keyed by the field's immutable key, and money is stored in cents. (BUILD-78)
- **The mapper creates no field without an explicit accept, and saved mappings store field ids, not labels.**
  A proposed `select` field must carry its options, or the seam returns 400. (BUILD-78, BUILD-83)
- **Use the one column-target dropdown, `ColumnTargetSelect.jsx`, for every shape.** Two columns may not map
  to one target, and "Guess from contents" may only fill a target nobody has claimed. (BUILD-83)
- **Treat an import as history.** It posts nothing to the ledger, fires no workflow, opens no thread and
  sends nothing. When Finance and Reports disagree, `hasUnledgeredGiving` explains the gap; never show a
  bare $0. (BUILD-25, BUILD-26, BUILD-81, BUILD-83)
- **An import writes `suggested_stage`, never `stage`, and only where `stage IS NULL`.** An explicit stage
  column still wins. `stageAssignmentBasis` derives the basis sentence from the fields it actually used. (BUILD-83, BUILD-84)
- **An import never assigns donors to the importer.** Owners come only from a mapped owner column on Team,
  and `buildAssigneeResolver` checks each against this org. A pending invitee is held as `invite:<id>`. (BUILD-30, BUILD-36)
- **Give every imported gift a fund and a payment method.** A named fund matches the org's funds
  case-insensitively, otherwise it is created unrestricted. `fundNameFromCell` refuses a money-shaped cell.
  The payment method is its own field, never the gift type. (BUILD-88a)
- **A gift is a duplicate only when the source id, donor, amount and date all match.** A colliding id imports
  as its own gift with `external_id` NULL and is counted. No two gifts in one payload may share a source id. (BUILD-83, BUILD-88a)
- **Giving-source and funder files never match a donor by name alone.** Use an exact email, an EIN or an
  external id, or create a new record and report it. A funder name that matches a person is refused by line. (BUILD-89S, BUILD-100)
- **Send `identityResolved` when the client has already resolved identity.** Without it, the server's email
  fold undoes a household that named one person. (BUILD-82, BUILD-88a)
- **Judge "future-dated" against the org's civil today** (`orgCivilToday`, `localCivilToday`), never UTC
  `new Date().toISOString()`. No `|| today` fallbacks: `scanTodayFallbacks` is pinned at 0. (BUILD-79, BUILD-84)
- **Decide dd/mm or mm/dd per column from the evidence.** A column that mixes conventions blocks the import
  rather than being guessed. (BUILD-80, BUILD-84)
- **Parse money through the one grammar.** `(1,000)` and a trailing minus are negatives. A constant formula
  (`=250*1`) is a number flagged as computed; any other formula is refused with its text. (BUILD-58, BUILD-80, BUILD-83)
- **Read payment statuses as stage words.** Paid or succeeded means received. Refunded, failed, pending,
  voided or chargeback is set aside by name. "Partially refunded" is deliberately unknown, so a person decides. (BUILD-98)
- **Build the pre-write summary and the write from one source** (`buildWorkbookSubmission`). The receipt
  reads back every `IMPORT_PROMISE_FIELDS` key from the database, and an unread one shows in red. (BUILD-82, BUILD-83)
- **Store the import's summary on its `imports` row and never recompute it.** A mismatch in cents is a
  finding on the row. `importSentence.js` says "accounted for" only when the cents balance, and a fold is not a set-aside. (BUILD-87)
- **Size batches as a round-trip budget**: about 1,000 donors and 2,000 gifts per batch, capped by
  Postgres's 65,535-parameter limit. (BUILD-83)
- **Resolve import extras (soft credits, tributes, matches, proposals, memberships) by name after the import
  transaction commits.** Memberships ride the last chunk so every person already exists. (BUILD-98, BUILD-99, BUILD-101)
- **Never let a bare "Amount", "Score", "Rating" or "Level" claim an ask, a wealth screen or a membership.**
  Anchor those regexes on their qualifying word. A vendor wealth screen never feeds `wealth_score`. (BUILD-99, BUILD-101)
- **Import an unsubscribed contact as unsubscribed in both `do_not_email` and `email_suppressions`.** Match a
  tag only as a whole tag: "Board Game Night" is not a board member. (BUILD-94)
- **Normalise imported names with `normalizeName`** (server and client kept in lockstep). A human-cased name
  stays as written, and a manual edit is never re-normalised. (BUILD-26)
- **Serialise an org's import dedupe with `withAdvisoryLock('import:'+org)`.** Never add UNIQUE(email),
  because duplicate donor emails are legitimate. (BUILD-27)
- **Pass every export cell through `reportCsvCell`'s formula-injection guard.** Org export routes are
  admin-only and never `checkWriteAccess`-gated, so a lapsed org can still leave with its data. (BUILD-03, BUILD-98)
- **Make the bookkeeper export foot in cents before a byte is written, or answer 409.** It is a report key
  on the one file layer, not a new route. (BUILD-87)

- **A vendor preset that names both a date and an amount outranks the generic shape guess.** A preset
  claims a file only on two of that vendor's own signals, so it is stronger evidence than a heuristic over
  header spellings. A real DonorPerfect gift export read as "one row per donor (totals)" and landed no money
  at all. (TRANS-1)
- **The old system's own id matches FIRST**, then email, then name. `external_donor_id` was written on the way
  in and never read, so correcting an address in the old system and re-exporting created a second person. A
  person matched by email who carries a source id is taught that id, fill-missing only. (TRANS-1)
- **Every import path records its run.** The run id is minted by the client BEFORE the write and passed to
  both `/donors/import-combined` and `POST /imports`, so gifts and new people carry `import_id` and a Move
  Report can scope to a file. Only the workbook flow used to record a run at all. (TRANS-1)
- **A Move Report's two sides measure the same thing: the whole move, not one run.** A re-export is the org's
  whole file again, so a per-run held side made the second report read "8 fewer gifts than your file" about a
  move that had lost nothing. Both sides also key identity the same way (source id, then email, then name). (TRANS-1)
- **Under one source id, a couple form that names the person is the same record** ("Jeffrey & Jessica Morales"
  beside "Jeffrey Morales" under D10530). An email or a name alone still never folds a couple into a person. (FIX-33)
- **Two different source ids join by email only with a compatible name.** Otherwise which twins merged depended on
  the 500-donor chunk they fell in. Uncertain pairs stay two records and wait in Data health. (FIX-33)
- **A trailing currency code is money** ("125.00 USD"), like a leading one. Headers are matched as written and as
  tokens, so "E-mail Address", "Phone #", "ST" and "Fund/Designation" reach their standard homes. (FIX-33)

- **A file the mapper would dead-end on goes to the adaptive reader, never to "shape unclear" (IMPORT-3).**
  `shared/sheetRead.js` finds the table anywhere and reads columns by contents; `wantsAdaptiveReading` sends it
  files with no date column (unless one row per donor with totals), a paid/pledge-total column, a pledge list,
  couples with no email, subtotals, yearless dates, several tables on a sheet, or an unknown sheet. The preview
  and the write are one plan (`/sheet-import/understand` writes nothing, `/sheet-import/commit` writes it through
  `recordGift`, shape `sheet` undoes whole). A model may only propose a column's role; the cells decide amounts.
- **A row with no name is a total only when it says "total" or foots to the cent.** Otherwise it is a row set
  aside by line ("no name"), never a gift and never a silent drop. (IMPORT-3)
- **A person is created only when the file gives them a gift or a pledge, or the file is a list of people.**
  A refunded or withdrawn line alone makes nobody a record. (IMPORT-3)
- **The messy-file set grades the reader, so its answer key never comes from the reader.**
  `tests/fixtures/import/messy/make.cjs` computes each key from the rows it writes. (IMPORT-3, after BUILD-77)

- **An import reads in layers and loses nothing (IMPORT-4).** `understand()` in `shared/sheetRead.js` builds
  People (sheets that list the same people merge: a shared ID first, then email, then the exact name with no
  contact detail that disagrees), Roles (donor, pledger, event guest, prospect, volunteer, board, staff, else a
  contact; a person with no gift is never a donor), Money, Engagement (invited, RSVP, attended, table, party size,
  logistics; opted out, do not contact, do not mail, do not call, each with its source) and Everything else.
- **Every column is mapped, kept or skipped with a reason; never "Don't import" by default.** A column Steward has
  no field for is kept as a text custom field under its own header (`created_source` `import:<file>`); past the
  40-field limit, as a note on the person. The only column that still blocks is a money-shaped one on a sheet with
  no amount yet, because guessing would make up money. The preview states `columnAccount` (total = mapped + kept +
  skipped). This replaces BUILD-78's "no field without an explicit accept" for this reader: the Import button,
  which names the kept columns, is the accept.
- **A gift with a person and an amount always lands.** A blank or unreadable date is an undated gift
  (`gifts.date IS NULL`), never a set-aside row. "Oct 2026" is the 1st with the file's words kept; "FY26" is
  undated with its words kept. `POST /imports/:id/date-undated` dates a run's undated gifts in one click.
- **A shared ID links sheets.** A gift sheet's ID column whose values are the people sheet's IDs is the person,
  and gifts attach by it, never by name. Matching an org's existing people tries that ID first (TRANS-1).
- **An email or phone on three or more people with different last names is a placeholder**: never used to tell
  people apart and never copied onto anyone.
- **A column that totals the gifts ("Gave at dinner") is skipped only when it foots person by person**; otherwise kept.
- **An event the file shows is created even without a date** (`events.date_unknown`, on the import's day, "Date not
  known" on its page, never "Coming up"). Its name comes from a title row, the file name, or a question that blocks
  only when Steward cannot guess one. Attendance is one `event_attendees` row per person (a couple's row is two).
- **The button says what will exist afterwards** (`importButtonSentence`); over 5% of people or dollars set aside,
  it says "Review N set aside first" until the list is opened.
- **Undo restores a person who was already here exactly**: the fields the import changed are kept in
  `summary_json.personChanges` and put back; attendance, suppressions, timeline lines, kept values and the fields
  and funds the run made go with it.

- **A spreadsheet import is a job, written in one transaction (FIX-52).** `POST /sheet-import/commit` writes a
  `sheet_import_jobs` row and the write runs behind it inside `db.withAmbientTransaction` (every `query`/`run`,
  `recordGift` included, goes to one client), batched by table. A failure rolls back the whole file and the job says
  why; a half-import cannot exist. The modal and the Imports list read the job (`GET /sheet-import/jobs/:id`), never
  a dropped request. While a job runs, the same file and preview (or the same run id) is that job, never a second
  write; once it is done the same file is a new run that adds nothing. `background: true` answers 202; without it
  the request waits for the same job and answers as before.
- **Match an org's people set-wise before asking the matcher (FIX-52).** `orgPeopleIndex` reads the org once; CHECK-2's
  `matchDonor` is still the one matcher and is skipped only where nothing shares an email, an ID or a word of the
  name, so it can only answer "none". The model is asked during the preview only; its proposals ride the commit as
  overrides (`modelOverrides`). On 27 Oct the commit was about 6,800 statements, each its own round trip.
- **A receipt counts pledges (FIX-52).** Rows = gifts + pledges + set aside + errored; dollars the same
  (`summary.pledgesCreated`, `summary.pledgeDollarsCreated`). A row already here is set aside as such. A pledge is its
  own row's amount, never a total column.
- **Every receipt that reverses as a whole offers Undo for its window, reconciled or not (FIX-52).** `importUndoWindow`
  says so; the sheet window is 30 days. Undo confirms with counts first (`GET /imports/:id/undo-preview`). People the
  file made that were deleted by hand since are removed with the rest and counted as "already deleted".
- **A notes sheet is not people (FIX-52).** A table with a reviewer's columns ("What to check", "How matched") and no
  money, whose rows mostly name people another sheet lists, is notes: not imported, its columns not kept, unless she
  says "Import it anyway" (`answers.notesSheets`). Counts written above a header ("People 443") are notes, and the
  preview's counts are checked against them by row and by person (`figureChecks`).
- **A person the file creates starts at the stage their role says (FIX-52).** Gave: `steward` (Ongoing care). Only
  pledged: `solicit` (the stage list's own reading of "pledge pending"). Otherwise `prospect`. A person already here
  keeps their stage.
- **A column about the gift lands on the gift, never the person (HARDEN-1).** On a table of gifts, a "Category" (or
  Class, Gift category, Income category) is each gift's campaign or appeal (`gifts.campaign`), and any other column
  whose value differs between one person's gifts goes on each gift's note under its header (role `giftNote`). Memo is
  the gift's note. Kept on the person, a donor who gave to a gala and a 5K kept only one. An event-like category
  ("Bourbon & Breeders Gala") is a campaign name, not a new event: the event's raised figure already falls back to the
  campaign name, and making events from a category would invent dates and attendance.
- **A comma is "Last, First" only when what follows can be a first name (HARDEN-1).** A company ending after it
  ("…, Inc", "…, LLC", "…, U.S.A") is an organisation; a person's suffix ("Perel V. Warville, Jr"), a place in capitals
  after a mixed-case name ("…, OAKWOOD"), or three or more words before it keep the name exactly as written.
- **A business's own words make an organisation, as whole tokens (HARDEN-1).** `isOrgName` in sheetRead.js: ORG_WORDS
  plus `ORG_TOKENS` (store, farm, services, realty, construction, excavating, inn, community, unlimited, cafe, …), dots
  dropped first. Initials joined by "&" ("S & S Westford") are a business, never two people of one initial. A Last
  Name of two or more words with no First Name is an organisation, its words as written (the farms in a contacts
  file); one word alone ("Foxland" on a dinner list) is a family's surname and stays a person.
- **A name-only match to someone deleted is a question (HARDEN-1, after FIX-54).** "Is this the same Stephen Gray you
  deleted?": Same person (default, stays out) or Different person (imported as new), in `answers.deletedPeople`,
  which rides the commit. A match by the old system's ID or by email stays blocked with no question.
- **Every import door opens the one reader (HARDEN-1).** Donors' "Import a spreadsheet", Settings, Imports, onboarding
  and Home's openImport all open `SpreadsheetImport.jsx`. The old "Import Donors" mapper (DonorImport, GiftHistoryImport)
  is no longer rendered; its code stays for the shared parsers. Its past runs (shapes `aggregate`, `wide`, `workbook`,
  `both`) undo whole from their receipt for 30 days. A run with no gift rows is counted in people on its receipt
  ("656 rows of people in the file = 589 added + 61 already here + …"), never "0 rows in the file", and a run with no
  gift from the 30 days before it never shows the thank-you answer. Undo also removes the open "Review N possible
  duplicates from the import" task its Data health run opened.
- **A method the reader cannot name keeps its words (HARDEN-1, IMPORT-3).** "Online (Miss)" is method Other with
  "Method in your file: Online (Miss)" on the gift; it is still a received gift when Completed says Yes. A pledge has no payment-method column, so how it will be paid
  ("Stock", "Foundation", "Retirement Dist") rides its note. A monthly word ("Reccuring") is kept on the gift's note
  and flags the person as a monthly giver for her to confirm; no plan and no pledge is made from it.
- **A negative row whose words say money went out is an expense, not a refund (HARDEN-1).** "Purchase of Oakwell
  Horse" (-$4,800) is set aside as "money paid out … an expense, not a gift" (`PAID_OUT_RE`).
- **The real-shaped files grade the reader (HARDEN-1).** `tests/real-shaped.test.js` imports
  `tests/fixtures/import/real-shaped/` (scrubbed from a real customer's files; the only customer-shaped files allowed)
  into an empty org and checks them to the cent against `expected.json`, whose `years` are net of the negative rows.

## Gotchas
- **A catch inside the mapper's memos turned a TDZ bug into "No rows ready — map a column".** Make
  `rethrowProgrammerError(e)` the first line of those catches, and use `errorMessage` in async handlers. (BUILD-84)
- **Hand-built fixtures split `$1,000.00` into two cells.** Read fixtures through `analyzeCsvText`, never a
  naive split. (BUILD-98)
- **Clock-dependent goldens go red on a calendar day.** Pin a pure golden to its fixture's `anchorDate`.
  Point a suite that asks the server about "now" at `civilToday()`. (BUILD-84)
- **Never round-trip a timestamp read off a row back into a comparison against that row.** Postgres keeps
  microseconds and a JavaScript `Date` holds milliseconds, so `committed_at <= ?` made a run EXCLUDE ITSELF.
  Order in SQL and cut the list by id. (TRANS-1)
- **The grep wrapper returns nothing on `shared/importShape.js`.** Use `/usr/bin/grep -a` or node. (BUILD-79, BUILD-82)
- **`shared/package.json` (type: module) is load-bearing.** `importShape` and `customFieldShape` form a
  deliberate ESM cycle, so use call-time bindings only. (BUILD-79, BUILD-82)
- **Calling `onImported()` on completion closes the import modal at once.** Fire it from the Done button only. (BUILD-82)
- **Sending workbook folds as a string made every undo record skip silently.** The payload must be an array
  that carries each identity's gift ids. (BUILD-83)
- **A variable collected inside `withTransaction` and read afterwards must be declared outside it.** (BUILD-98)
- **The receipt crashed on a file with extras but no column ledger.** A browser leg must listen for the
  ErrorBoundary's console line, because a swallowed crash raises no page error. (BUILD-101)
- **New org-child tables (for example `import_merges`) must join every suite's org-reset DELETE list.** Clear
  `fin_transactions`, `budgets`, `accounts` and `fin_funds` before deleting orgs. (BUILD-58, BUILD-80)

- **Two components were both called SheetImport for an hour.** `SheetImport.jsx` is SHEETS-1 (grants and board
  reports, on Grants and Reports); the any-spreadsheet screen is `SpreadsheetImport.jsx`. Check a name with
  `git ls-files` before creating a component. (IMPORT-3)

## Where the code is
- `shared/sheetRead.js` + `routes/sheetImport.js` + `client/src/components/SpreadsheetImport.jsx`: the adaptive
  reader for any spreadsheet (IMPORT-3), read in layers (IMPORT-4); `tests/import3.test.js` with
  `tests/fixtures/import/messy/`, `tests/import4-layers.test.js` with `tests/fixtures/import/import4/`
- `shared/importShape.js` — the whole pure layer: header tokens, shape detection, `analyzeCsvText`,
  `decodeSpreadsheetBytes`, money/date/id normalisers, `classifyColumns`, the workbook reader and builder,
  `resolveDonorIdentity`, `IMPORT_PROMISE_FIELDS`
- `shared/textMatch.js` — boundary-respecting matching (`containsTokenRun`). Never search stringified JSON.
- `shared/customFieldShape.js` + `customFields.js` `validateCustomFields` — the one custom-field seam
- `shared/migrationPresets.js`, `sourcePresets.js`, `mailchimpPreset.js`, `npspPreset.js`, `grantImport.js`,
  `membershipImport.js` — the presets
- `shared/importSentence.js` — the receipt's one sentence
- `client/src/components/Donors.jsx` `DonorImport`, `WorkbookImport.jsx`, `ColumnTargetSelect.jsx` — the old mapper's UI,
  no longer opened by any door (HARDEN-1); `SpreadsheetImport.jsx` is the one import screen
- `server.js` `POST /donors/import-combined`, `/donors/import-semantics` (fold undo via `import_merges`),
  `recalcDonorSummaryBatch`, `importGiftExtras`
- `bookkeeper.js`, `reportToCsv` / `sendReportCsv`, `GET /org/export/csv`, `GET /org/export/full` — exports
- `client/src/lib/domainError.js` — `rethrowProgrammerError` / `errorMessage`

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## One-file import and workbooks (moved from the old CRITICAL WORKING RULES)

- **One-file magical import — auto-detects file SHAPE, builds donors + individual gift history in one pass (FIX, 2026-07-21).** The exported `DonorImport` (Donors' "↑ Import" button AND onboarding step 2, `withHistory`) now detects the uploaded file's shape via `client/src/lib/importShape.js` (`detectImportShape`, JSX-free + Node-testable, ONE source of truth for `YEAR_HDR_PAT`) and adapts: **aggregate** (one row/donor with Total/Last-Gift — seeds one gift/donor from total+lastGift when `withHistory` so onboarding gets queryable gifts rows), **transaction** (one row per GIFT, donor repeated — `groupTransactions` groups by donor email-else-name, creates each donor once, attaches EVERY row as an individual gift → the big unlock: a raw gift export becomes donors + full history), or **wide** (year columns → a gift per funded year, reuses `buildCombinedRows`). A gold **"We detected: …"** banner states the shape with a one-tap override select; the smart-stage preview + messy-row tolerance + mapping UI are unchanged. All three build the `{donors, gifts:[{donorIndex}]}` payload `/donors/import-combined` already consumes (server dedupes by email org-scoped, attaches, recalcs, re-infers stage). **Large imports no longer hang**: (1) the server's per-donor `recalcDonorSummary` loop in both `/donors/import-combined` + `/gifts/import-history` was replaced by ONE set-based `recalcDonorSummaryBatch(donorIds, orgId)` query (the N+1 was cheap locally but exploded under remote-DB latency — 1,490 rows went 1,167ms→160ms locally); (2) the client submits in **500-donor chunks with a live progress bar** ("Importing X of Y…"), each chunk self-contained (its gifts re-indexed) so no single request can time out and cross-chunk email dedup works (chunk N sees chunk N-1's committed rows). Re-running is idempotent (existing donors deduped → their gifts dropped). Guarded by `tests/import-shape.test.js` (16 — detection of all three shapes + edge cases + grouping) + `tests/import-combined.test.js` (30 — transaction ledger→donors+history+smart-stage, batch-recalc last-gift correctness, idempotent re-run, 1,500-donor import <10s, org isolation). DSF3 screenshots: `docs/import-magic-2026-07-21/`.
- **Multi-sheet workbooks offer "Import both" — donor sheet + gift sheet linked in one pass (FIX, 2026-07-28).** The most common real CRM export is one `.xlsx` with a **Donors** sheet AND a **Gift History** sheet. Previously the multi-sheet picker forced picking ONE sheet (import the other "separately afterward"). Now `DonorImport` runs `detectImportShape` on **every** sheet (via `detectWorkbookRoles` in `importShape.js`): when one reads **donor-shaped** (aggregate/wide) and another **transaction-shaped** (gift ledger), it recognizes a "donors + gift history" workbook and shows a prominent green **"Import both — donors + their gift history"** CTA ABOVE the per-sheet "Use this / Select" options (kept as the one-at-a-time fallback). "Import both" links each gift row to its donor by a shared key — **email → donor name → a donor-id column** (`pickMatchKey`, priority order; `findDonorIdHdr` probes "Donor ID"/"Constituent ID"/bare "ID" etc.) — shown with a one-dropdown override (same spirit as the shape banner). It imports **in one pass**: donors from the donor sheet (NOT history-seeded — the real history is the gift sheet, so seeding would double-count), each gift-sheet row attached to its matched donor as an individual dated gift, then **smart-stage** runs server-side on the real linked history (Jane's recent gift → steward, Bob >365d → lapsed, Carol $1500@120d → solicit). **Messy-row tolerance (never silently drops):** a gift whose donor isn't in the donor sheet becomes a **minimal donor created from the gift row** (deduped by its own email-else-name) so its history survives — surfaced in the counts ("N gifts → M donors · K unmatched → J new donors · W warnings"); a gift row with no amount / no donor identity is counted as skipped, not attached. All of this builds the same `{donors, gifts:[{donorIndex}]}` payload and reuses the **500-row chunked submit + progress bar + email-dedup idempotency** (re-run = 0 dupes, org-scoped) — `buildBothPayload` (Donors.jsx) + `linkGiftsToDonors` (importShape.js, JSX-free) are the only new logic. **Onboarding uses this path** (the exported `DonorImport`) so a first-timer drops one workbook and gets a full CRM. Single-sheet flows (aggregate / transaction / wide-year) are unchanged. Guarded by `tests/import-both.test.js` (32 — role detection incl. two-donor-sheets→not-both, match-key pick + donor-id probe, email/name/donor-id linking, unmatched→minimal-donor never-dropped, no-identity→skipped, and the server contract: linked payload → smart-stage per donor, idempotent re-run 0-created/4-dupes, org isolation).

## REPORTS-5 · old reports are kept, and their numbers are history, never gifts (2026-10-07)

- An old system's report is kept as a file, always (`stored_sheets` kind `old_report`). Its numbers come in only when
  the person maps them, and only as `historical_totals`. Nothing in an old report becomes a gift or a person.
- The reader is `oldReports.js`: CSV and PDF are read on the server (a PDF by its text; a scan is kept and its
  numbers are refused, never OCR'd), Excel in the browser. A table's Total line is set aside and checked.
- History reaches a screen only through `figureSources.historicalGiving` and the `historical-totals` source, so it
  opens and foots, and every screen labels it "from your old system". It sits beside Steward's numbers, or stands in
  for an empty period; it is never added to them.
- One import is one batch, and undoes in one step: files and totals together.
- **Notes and history come in through one wizard (IMPORT-2).** `shared/historyImport.js` judges every row (kind,
  date, author, task, preference, match) and `routes/historyImport.js` previews and writes from that one plan. Match
  by the old system's id, then email, then name; more than one person or nobody waits for a person. A preference
  found in a note is proposed and set only when confirmed. Every row carries the run (`interactions.import_id`,
  `tasks.import_id`, `donor_relationships.import_id`), and `/imports/:id/reverse` undoes the `history` shape whole.
- **In a history file, read a date month first, and day first only when it cannot be month first (20/10/2023).**
  Every such row is listed in the preview. This is Jonathan's rule (8 Oct 2026) and is per row, unlike the gift
  importer's per-column evidence rule above, because notes files mix exports from years of different settings.
- **A folded person keeps every old id.** Two rows of one person under two ids keep both: the first in
  `external_donor_id`, every id in `external_donor_ids`. A history file naming the second id must find them. (IMPORT-2)
- **A Notes, Comments or Background column in a donor file becomes a dated note on the person**, once per person per
  wording, dated by its gift row, tagged with the run so the run's undo removes it. (IMPORT-2)

## LIVE-1 · a CSV gift behaves like every other gift (2026-10-12)

- Both gift import routes split a file: a gift dated in the last 30 days (historyGifts.js) goes through
  `recordGift` with `history: true` after the batch commits, so it gets a thank-you draft and can start a
  journey; an older gift stays in the batch writer and starts nothing. Recent gifts run in four lanes, one
  donor per lane at a time, with `importGiftContext` hints so recordGift skips checks that cannot fire.
- The preview says how many thank-yous a file will draft (`POST /imports/thank-you-preview`), before saving.
- Every import calls the after-change step once per chunk (`afterChange.js`), never once per row. The
  donors-only CSV passes `recalc: false`: its totals are the file's, with no gift rows behind them.
- A file maps itself: the answers are saved against the header shape (`import_shape_mappings`, "d:" a
  donor field, "t:" a gift field), and a later file whose headers include every saved column is filled in
  and asks only about the new ones. Value answers ("CHK" is Check) live in `import_value_mappings` and are
  applied by the server to every later file.
- Undo removes the journeys an import's gifts started (`cultivation_plans.started_import_id`) and its
  readout. An "Import + History" file (shape `transaction`) now undoes as a whole within 7 days; fields
  it filled on people who already existed are not reverted.

## FIX-37 · an import never floods the thank-you queue, and big files don't wait (2026-10-12)

- Before saving, an import whose file would draft thank-yous asks "Have the gifts from the last 30 days
  already been thanked?": "Yes, don't draft thank-yous" / "No, draft them all" / "Only gifts of $___ or
  more". The default is decided in ONE place, `importThanks.js` (`defaultAnswer`): "Yes" for an org's first
  import (no run on file that was not undone), for a file recognised as another system's export
  (Bloomerang, DonorPerfect, Neon, Little Green Light, Kindful through the mapper presets, Salesforce through
  the NPSP preset, Raiser's Edge by its own description columns), and for more than 50 recent gifts;
  otherwise "No". `POST /imports/thank-you-preview` returns it; an import that arrives with no answer (an
  API caller, the workbook flow) is given the same default by the route.
- "Already thanked" is `recordGift({ alreadyThanked: true })`: the gift is recorded and counted, with no
  thank-you draft, no gift journey and no gift sequence. The answer is saved on the run
  (`imports.thanks_answer`) and shown in Settings, Imports.
- An org's first import writes the readout "What your history shows" with no "new donors" lines, and
  keeps lateness for everyone (their rhythm comes from the file's dates). Later imports are unchanged.
- The recent-gift work runs BEHIND THE SCREEN. In the import's own transaction the recent gifts are written
  as work rows (`import_recent_work`) under one job per run (`import_recent_jobs`); after the response,
  `runRecentWork` in routes/crm.js records them through recordGift and then runs the after-change step for
  everyone the run touched. Progress is `GET /imports/:id/progress`. A restart resumes running jobs from
  their work rows. Undo cancels the job, waits for the gift in flight, clears the work rows, then removes
  what was written. The readout is written by whichever of the job's end and `POST /imports` comes second
  (`readout_claimed`). This is the one place import work runs in the background; SCALE-1 moves it to a
  queue.
- Undo now also removes the timeline lines an import's journeys wrote ("Journey started", each step), so a
  person the file created is removed rather than kept alive by them.
