# BUILD-79 FINDINGS — the file layer, and green on garbage

Fixture: `tests/fixtures/build79/steward-messy-2500-v2.csv` (438,319 bytes, UTF-8 BOM,
4 CP1252-byte lines). Generator `gen-messy-v2.py`, seed 20260905 (Cowork-side; not in
this repo — see BLOCKED-build79.md for the fixture-key situation).

## Part 0 — the reproduction (fails-first record)

`scripts/build79-repro.js` against the local stack (fresh org, real UI, the same
mapping prod's AI auto-map chose: First Name → first name, Spouse → last name,
Phone → email, Frequency → last gift). Screenshots + logs: `docs/build79/repro/`.
Every number from Jonathan's Sept 5 prod run reproduced exactly:

- Mapper: header taken from line 1 (`Donor Giving History Report`), shape
  **"one row per donor"**, **"2,510 rows"**.
- Import button: **"Import 2,438 donors"**.
- Result screen: green check, **"EVERY ROW AND EVERY DOLLAR ACCOUNTED FOR ·
  Balanced · 2,438 · $0"**, Imported 1,111 · Skipped 1,327 **"already on file"**
  (in a fresh org), **"2372 imported with warnings"** with no warning visible or
  downloadable, 72 skipped (no name or email).
- DB truth: 1,111 donors, **0 gifts, $0.00** against a file whose own TOTAL row
  reads **$2,035,978.52**. All 1,111 `last_gift_date` are **NULL** — the "Sep
  2026" shown on every row is `client/src/api.js:122`'s read-side `|| today`.
- Donor list: **355 donors whose display name is a phone number**, every score
  **35** (= 5 for total≤$1k + 30 for "last gift < 90 days ago", the read-side
  today fallback), every last gift "Sep 2026" (`docs/build79/repro/08-donorlist-1440.png`).
- Home: Needs Your Attention lists `(502) 220-8677` with a **Log call** button
  (`09-home-1440.png`).
- Export: succeeds locally (client/ exists here). The prod failure is the
  deploy-shape bug — Part 7.

## THE EIGHT NUMBERS (one file, four sizes shown to the customer)

| number | where it appeared | exact derivation |
|---|---|---|
| **2,853** | physical lines in the file | 2,852 lines + trailing newline |
| **2,517** | (internal) CSV records | quoted embedded newlines collapse 336 physical lines |
| **2,510** | mapper "2,510 rows" | 2,517 − 1 (line 1 taken as header) − 6 blank records (Papa `skipEmptyLines`) |
| **2,500** | records a correct parser yields | 2,510 − 10 chrome rows inside the data (the real header on line 4 read as data, 3 repeated headers, 3 `Page N of M` lines, the TOTAL row, `End of report`) − blank line 3 already skipped |
| **2,438** | summary "In your file" | 2,510 − 72 rows with empty First Name AND Spouse AND Phone (client "no name or email" skip) |
| **1,327** | "already on file" | duplicate collapses of the 1,021 distinct phone numbers (Phone was mapped to email; server dedups by email, within-file) |
| **1,111** | donors imported | 1,021 distinct phones + 90 rows with an empty phone (each kept individually) |
| **$0 vs $2,035,978.52** | summary dollars vs the file's own TOTAL row | no amount column mapped → both sides of the dollar equation were zero → "Balanced" |

Two different sizes for the same file appeared on ONE screen sequence
(2,510 on the mapper, 2,438 on the summary) — failure-class entry #7.

## THE RULE — every import shape, every string→date/amount/name path (enumerated)

Import shapes (client): **aggregate** (`buildDonorRows`/`buildAggregatePayload`,
Donors.jsx:220/342), **transaction** (`buildTransactionRows`, importShape.js:732 —
the only path with full BUILD-77 treatment), **wide** (`buildCombinedRows`,
Donors.jsx:273), **import-both** (`buildGiftItemsFromLedger`, importShape.js:~230),
plus the legacy **GiftHistoryImport** (Donors.jsx:1846). Server routes:
`POST /donors/import` (3992), `POST /donors/import-combined` (4145),
`POST /gifts/import-history` (6245).

`|| today` fallbacks alive at Part 0 (all client-side, all outside
build72-date-audit's scan set, which reads only server.js/db.js/drift.js):

1. `client/src/lib/importShape.js:257` — import-both ledger builder:
   `date: parsedDate || new Date().toISOString()...` (write path).
2. `client/src/components/Donors.jsx:1947` — GiftHistoryImport:
   `finalDate = parsedDate || today` (write path; `/gifts/import-history` also
   has no future-date guard).
3. `client/src/api.js:122` — `adaptDonor`: `lastGift: d.last_gift_date || today`
   (read path; the "Sep 2026" and the 35 score on this fixture).

Name → phone/email fallback: `buildDonorRows` Donors.jsx:242 (`d.name = email`),
`buildCombinedRows` :294, `buildTransactionRows` importShape.js:772
(`name: name || email`). Server never synthesizes (skips `no_usable_name`).

Header detection: **none anywhere** — Papa `header:true` takes row 0
(Donors.jsx:175); shape default is `else shape = "aggregate"`
(importShape.js:331) with no evidence requirement.

## Part 7 scope — what is dead in production at d17d6c2, right now

`.railwayignore` excludes `client/` from the Railway tarball. Two server-side
importers reach under it: `server.js:14821` `cfShape()` and `customFields.js:29`
`shape()` — both `import("./client/src/lib/customFieldShape.js")`, which
transitively needs `client/src/lib/importShape.js`. Lazy, so the server boots;
each seam dies on first use:

| surface | call site | dead in prod when |
|---|---|---|
| `GET /donors/export/csv` | server.js:3660 | **always** (Sentry, Sept 5 19:34 UTC) |
| `GET /org/export` (the "your data is yours" zip) | server.js:18635 | **always** |
| `POST /donors/import-combined` — column-axis check | server.js:4203 | whenever the payload carries `columns` — i.e. **every transaction-shape import through the current mapper** |
| `POST /donors/import-combined` — custom-field values | server.js:4226/4233 (via customFields.js) | whenever any row carries `customFields` |
| `PUT` manual donor / gift custom values | server.js:14970/14989 | **always** (custom-field writes broken since d17d6c2) |
| field-mapping upsert | server.js:4672 | whenever `fieldMappings` ride the import |
| custom-fields settings routes | server.js:14842/14892 | always |

Jonathan's aggregate import succeeded in prod because the aggregate payload
carries neither `columns` nor `customFields` — the only reason 1,111 donors
landed at all. **Every BUILD-78 custom-fields assertion passed against a build
the customer never gets.**

## Part 7 — the fix, and the guard

**7.2** `client/src/lib/customFieldShape.js` and `client/src/lib/importShape.js`
moved to **`shared/`** at the repo root (customFieldShape imports importShape, so
both are runtime server dependencies; `.railwayignore` keeps `shared/`). All 20
import sites updated (server.js, customFields.js, Donors.jsx, 15 suites, the
migration-reconcile script). No copy, no symlink, no re-export shim.
`shared/package.json` (`"type":"module"`) is load-bearing: the root package.json
is CJS, so without the marker the moved ESM files parse as CJS and the server's
dynamic import dies a SECOND way — hit live while fixing, now pinned.

**7.3a** `tests/deploy-shape.test.js` (in run-all): computes the deploy artifact
list the way `railway up` does (git-tracked minus `.railwayignore`), statically
resolves every relative require/import in the server tree transitively from
package.json main, and fails on any resolution outside the artifact — plus the
ESM-marker check. Proven able to fail (BUILD-75 A.6): §4 runs the same checker
over a synthetic tree carrying the exact BUILD-78 defect and over one missing
the type-module marker; both are flagged, and the marker fix turns it green.

**7.3b** `scripts/status.js` now runs a post-deploy smoke and **"aligned"
requires it**: demo-org login → `GET /donors/export/csv` must answer 200 with
CSV-shaped bytes (the exact surface that crashed Sept 5) + `GET /custom-fields`
200. Same-commit-everywhere with a failing smoke prints "aligned is not claimed
until the deployed code WORKS" and exits non-zero. **Deliberate deviation from
the spec's "one custom-field write":** status.js is classified PROD_READONLY and
this repo's prod-write discipline (`--i-know-this-is-prod`) forbids a status
check writing to production; the write-path coverage lives in
tests/deploy-shape.test.js (static, proves the module ships) + the custom-fields
battery (drives validateCustomFields through the same module). The read-only
export GET exercises the identical dynamic import at runtime in prod.

**7.4** `Donors.jsx` export handler no longer throws an error whose message is
its own name: the flash now carries the HTTP status and the server's
error/message body. The round-trip-on-the-imported-org assertion lands with the
Part 8 golden.

## Part 1 — find the header, don't assume it

New report-export layer in `shared/importShape.js`, used by every parse entry
(CSV upload, paste, every XLSX sheet):
- `parseCsvRecords` — line-aware RFC-4180 records (Papa can't say which
  physical line a record started on once quoted newlines exist, and every
  chrome/refusal report speaks in line numbers).
- `detectHeaderRow` / `scoreHeaderRow` — evidence: vocabulary hits (≥3 to be a
  candidate at all), mostly-non-numeric, short cells, modal column count.
  Position contributes nothing; a title line can never win.
- `classifyBodyRow` / `analyzeSheetRows` — chrome above the header shown
  verbatim; repeated headers, `Page N of M`, TOTAL/Subtotal/Grand Total,
  `End of report`, and bare-currency lines excluded BY LINE NUMBER; the TOTAL
  row's amount captured for Part 3.2. A donor named "Total Insurance Co" is
  data, not chrome (anchored label match).
- `decodeSpreadsheetBytesDetailed` — strict UTF-8; on failure, BYTE-RUN repair
  inside only the failing lines (the fixture mixes encodings WITHIN one line:
  CP1252 `Garc\xEDa` in Name beside valid-UTF-8 `García` in Last Name — both
  line-level and whole-file fallback corrupt the valid cell). Never U+FFFD.
  Source-borne mojibake ("GarcÃ­a" already double-encoded in the bytes) passes
  through as data — a BUILD-80 semantic finding, the decoder never guesses.
- `dedupeHeaderCells` — blank → `_N`, duplicate → `name_N`, position-stable.

Client: chrome banner ("This looks like a report export — here's what we set
aside") lists the skipped lines above the header (with the header's line
number), every excluded row by kind + line, the file's own TOTAL figure, and
the converted Windows-1252 names. `parsed.rows` is now 2,500 on this file and
every surface reads it. **On the fixture, correct headers alone flip shape
detection to "individual gifts"** — Gift Date and Amount become visible, so the
Part 0 catastrophe was the header layer all along, exactly as the spec framed.
The mid-file stray-header row in v1 is now chrome (v1 through the UI reads
2,501); `buildTransactionRows`' `stray_header_row` disposition remains as
defense-in-depth for callers feeding un-analyzed rows.

Suite: `tests/import-header.test.js` (33) — in run-all. Lesson recorded: an
earlier local `build-local-dist` run FAILED on eslint (`no-undef`) while a
`tail -2` hid everything but eslint's warning summary — the walk then ran green
against a stale bundle; caught by mtime comparison. Check the bundle hash, not
the build's last two lines.

## Part 2 — shape is a decision with evidence, or it is a question

- `detectImportShape` now returns its `reason` and the list of `recognized`
  columns; **fewer than three recognised columns → shape `unknown`** — the
  banner turns to a question, the shape select gains a "— choose —" placeholder,
  and the import button is disabled until a human picks. The Part-0 garbage
  headers (line 1 as header → `_1.._21`) yield `unknown` (asserted).
- `assessAggregateCollapse(rows, emailCol, nameCol)` — full-file scan on the
  columns the mapping actually sends as identity. **Totals mode refuses when
  >1/3 of ≥30 keyed rows collapse within the file** (v2 keyed by phone: 1,327
  of 2,438 — refused; keyed by email — refused; the deduped one-row-per-donor
  set — allowed). Refusal banner offers one-click "Treat as individual gifts";
  `doImport` double-checks.
- Duplicate language split at the source (`/donors/import`): `already_in_steward`
  (matched a record that pre-dated this import) vs `duplicate_within_this_import`
  (another row of the same file). Response carries `duplicatesOnFile` /
  `duplicatesInFile`; the result headline and the reconciliation breakdown
  render them as different sentences. In a fresh org every collapse now reads
  as the file folding onto itself — never phantom "already on file" records.

Assertions: import-header §8/§9 (43 total). The fresh-org HTTP assertion rides
the Part 8 golden.

## Part 3 — the summary cannot say Balanced at zero

- **3.1** `scanAmountShapedColumns` (lib): the dollar line's left side comes
  from a raw scan of the file for the most currency-shaped column, computed at
  parse entry BEFORE any mapping exists. v2: `Amount`, $2,196,822.63 raw
  (currency-shaped cells only — `USD 750.00` styles are the parser's job and
  land in the accounting axis). No amount-shaped column at all → the line reads
  "unknown — no amount-shaped column found", never $0.
- The file-level equation now exists on **every** path: the aggregate/wide
  paths (which only ever echoed the server's payload-scoped ledger — how
  "Balanced · 2,438 · $0" happened) now take rows from parse entry
  (`parseReport.records`), fold the client's pre-submit skips in as reasons,
  and take dollars from the independent scan. The scan column is named on the
  panel ("scanned independently from your 'Amount' column — not from the
  mapping").
- **3.2** When Part 1 captured a TOTAL row, the summary shows the first
  reconciliation against a figure Steward did not compute: the file's own
  total, what Steward imported, the difference, how much of it is explained by
  skipped/errored dollars, and an honest note that a report's own total may
  count differently (soft credits/pledges/duplicates — BUILD-80's material).
- **3.3** GREEN IS EARNED: the check mark and "every row and every dollar
  accounted for" require amount mapped + date mapped + imported dollars > 0 +
  both axes balanced. Otherwise: amber ◑, "Imported — with gaps you should
  read.", a missing-list naming each gap (including "$0 was imported, but the
  file's 'X' column carries $N of currency-shaped values"), and the panel title
  downgrades to "The arithmetic — read the gaps above before trusting it".
  Verified live both ways (probe screenshots part3-amber-summary /
  part3-green-summary in docs/build79/repro/).
- **3.4** Warnings download as CSV with line numbers + reasons
  (imported-with-warnings.csv), same as refused rows; the aggregate builder
  stops discarding its `_warnings`.
- Leftover (documented): the import-both path's dead client equation (a
  BUILD-78 finding) still suppresses its file panel; its summaryHealth is not
  computed. Its gifts are real by construction; folding it into this layer
  rides with the Part 8/BUILD-80 work.
