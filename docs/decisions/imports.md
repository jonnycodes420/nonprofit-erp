# Imports

Read this when you touch file import (CSV, xlsx, workbooks), shape detection, the column mapper, money or date parsing, dedupe on import, exclusions, or export files.

## Rules
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

## Gotchas
- **A catch inside the mapper's memos turned a TDZ bug into "No rows ready — map a column".** Make
  `rethrowProgrammerError(e)` the first line of those catches, and use `errorMessage` in async handlers. (BUILD-84)
- **Hand-built fixtures split `$1,000.00` into two cells.** Read fixtures through `analyzeCsvText`, never a
  naive split. (BUILD-98)
- **Clock-dependent goldens go red on a calendar day.** Pin a pure golden to its fixture's `anchorDate`.
  Point a suite that asks the server about "now" at `civilToday()`. (BUILD-84)
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

## Where the code is
- `shared/importShape.js` — the whole pure layer: header tokens, shape detection, `analyzeCsvText`,
  `decodeSpreadsheetBytes`, money/date/id normalisers, `classifyColumns`, the workbook reader and builder,
  `resolveDonorIdentity`, `IMPORT_PROMISE_FIELDS`
- `shared/textMatch.js` — boundary-respecting matching (`containsTokenRun`). Never search stringified JSON.
- `shared/customFieldShape.js` + `customFields.js` `validateCustomFields` — the one custom-field seam
- `shared/migrationPresets.js`, `sourcePresets.js`, `mailchimpPreset.js`, `npspPreset.js`, `grantImport.js`,
  `membershipImport.js` — the presets
- `shared/importSentence.js` — the receipt's one sentence
- `client/src/components/Donors.jsx` `DonorImport`, `WorkbookImport.jsx`, `ColumnTargetSelect.jsx` — the UI
- `server.js` `POST /donors/import-combined`, `/donors/import-semantics` (fold undo via `import_merges`),
  `recalcDonorSummaryBatch`, `importGiftExtras`
- `bookkeeper.js`, `reportToCsv` / `sendReportCsv`, `GET /org/export/csv`, `GET /org/export/full` — exports
- `client/src/lib/domainError.js` — `rethrowProgrammerError` / `errorMessage`

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## One-file import and workbooks (moved from the old CRITICAL WORKING RULES)

- **One-file magical import — auto-detects file SHAPE, builds donors + individual gift history in one pass (FIX, 2026-07-21).** The exported `DonorImport` (Donors' "↑ Import" button AND onboarding step 2, `withHistory`) now detects the uploaded file's shape via `client/src/lib/importShape.js` (`detectImportShape`, JSX-free + Node-testable, ONE source of truth for `YEAR_HDR_PAT`) and adapts: **aggregate** (one row/donor with Total/Last-Gift — seeds one gift/donor from total+lastGift when `withHistory` so onboarding gets queryable gifts rows), **transaction** (one row per GIFT, donor repeated — `groupTransactions` groups by donor email-else-name, creates each donor once, attaches EVERY row as an individual gift → the big unlock: a raw gift export becomes donors + full history), or **wide** (year columns → a gift per funded year, reuses `buildCombinedRows`). A gold **"We detected: …"** banner states the shape with a one-tap override select; the smart-stage preview + messy-row tolerance + mapping UI are unchanged. All three build the `{donors, gifts:[{donorIndex}]}` payload `/donors/import-combined` already consumes (server dedupes by email org-scoped, attaches, recalcs, re-infers stage). **Large imports no longer hang**: (1) the server's per-donor `recalcDonorSummary` loop in both `/donors/import-combined` + `/gifts/import-history` was replaced by ONE set-based `recalcDonorSummaryBatch(donorIds, orgId)` query (the N+1 was cheap locally but exploded under remote-DB latency — 1,490 rows went 1,167ms→160ms locally); (2) the client submits in **500-donor chunks with a live progress bar** ("Importing X of Y…"), each chunk self-contained (its gifts re-indexed) so no single request can time out and cross-chunk email dedup works (chunk N sees chunk N-1's committed rows). Re-running is idempotent (existing donors deduped → their gifts dropped). Guarded by `tests/import-shape.test.js` (16 — detection of all three shapes + edge cases + grouping) + `tests/import-combined.test.js` (30 — transaction ledger→donors+history+smart-stage, batch-recalc last-gift correctness, idempotent re-run, 1,500-donor import <10s, org isolation). DSF3 screenshots: `docs/import-magic-2026-07-21/`.
- **Multi-sheet workbooks offer "Import both" — donor sheet + gift sheet linked in one pass (FIX, 2026-07-28).** The most common real CRM export is one `.xlsx` with a **Donors** sheet AND a **Gift History** sheet. Previously the multi-sheet picker forced picking ONE sheet (import the other "separately afterward"). Now `DonorImport` runs `detectImportShape` on **every** sheet (via `detectWorkbookRoles` in `importShape.js`): when one reads **donor-shaped** (aggregate/wide) and another **transaction-shaped** (gift ledger), it recognizes a "donors + gift history" workbook and shows a prominent green **"Import both — donors + their gift history"** CTA ABOVE the per-sheet "Use this / Select" options (kept as the one-at-a-time fallback). "Import both" links each gift row to its donor by a shared key — **email → donor name → a donor-id column** (`pickMatchKey`, priority order; `findDonorIdHdr` probes "Donor ID"/"Constituent ID"/bare "ID" etc.) — shown with a one-dropdown override (same spirit as the shape banner). It imports **in one pass**: donors from the donor sheet (NOT history-seeded — the real history is the gift sheet, so seeding would double-count), each gift-sheet row attached to its matched donor as an individual dated gift, then **smart-stage** runs server-side on the real linked history (Jane's recent gift → steward, Bob >365d → lapsed, Carol $1500@120d → solicit). **Messy-row tolerance (never silently drops):** a gift whose donor isn't in the donor sheet becomes a **minimal donor created from the gift row** (deduped by its own email-else-name) so its history survives — surfaced in the counts ("N gifts → M donors · K unmatched → J new donors · W warnings"); a gift row with no amount / no donor identity is counted as skipped, not attached. All of this builds the same `{donors, gifts:[{donorIndex}]}` payload and reuses the **500-row chunked submit + progress bar + email-dedup idempotency** (re-run = 0 dupes, org-scoped) — `buildBothPayload` (Donors.jsx) + `linkGiftsToDonors` (importShape.js, JSX-free) are the only new logic. **Onboarding uses this path** (the exported `DonorImport`) so a first-timer drops one workbook and gets a full CRM. Single-sheet flows (aggregate / transaction / wide-year) are unchanged. Guarded by `tests/import-both.test.js` (32 — role detection incl. two-donor-sheets→not-both, match-key pick + donor-id probe, email/name/donor-id linking, unmatched→minimal-donor never-dropped, no-identity→skipped, and the server contract: linked payload → smart-stage per donor, idempotent re-run 0-created/4-dupes, org isolation).
