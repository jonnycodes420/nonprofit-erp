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
