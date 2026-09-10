# BUILD-84 — findings

Four defects found 9 September 2026 importing `steward-leads.csv` (444 rows, the
990 lead pull) into a live org and then opening the Map; two censuses; one
feature. Every defect below was **reproduced first** against the real file, in
this repo, before anything was changed.

Suite: `tests/build84.test.js` (**136 assertions**, in `run-all.sh`).
Walk: `scripts/build84-capture.js` (**38 assertions, ALL GREEN**) — the real
444-row file through the real UI on a fresh org, then the Map.
Fixture: `tests/fixtures/build84/org-donors.csv` + `key.json`.

---

## Part 0 — reproduction

| Claim in the spec | Measured here, before any change |
|---|---|
| the scanner picked `drive_min_from_wilmore` at $12,840 | **confirmed exactly**: `{"header":"drive_min_from_wilmore","nonEmpty":444,"currencyCells":444,"dollarSigns":0,"sum":12840}` |
| `revenue`, `contributions`, `deficit`, `contrib_lost_yoy` sat unscanned | **confirmed**: all four passed the old shape test as *candidates* and all four lost the sort |
| 245 of 444 rows set aside as "no name or email" | **confirmed exactly**: 245 rows with no `contact_name` and no `email` — **all 245 carry an organization**, 140 of them a phone number, and **0** rows in the file have none of the three |
| stage split qualify × 159 / prospect × 40 | **confirmed by construction**: 444 − 245 = 199 nameable rows; `inferStage(0, null, hasContactInfo)` returns `qualify` with an email or phone and `prospect` without |
| the Map geocodes at render and stores nothing | **confirmed by reading it**: `DonorMap.jsx` called `https://nominatim.openstreetmap.org/search` in a `useEffect`, one address per request, `GEOCODE_DELAY = 1200`, results in `useState` only |

---

## P0-1 — the independent value scanner picks the wrong column

### The selection rule that was actually there

Not first-numeric-column-wins, though it behaved that way on this file. The rule
was: **every column whose cells parse as money is a candidate; the candidate
with the most currency-shaped cells wins; `$`-signs break ties; column order
breaks the remaining tie silently.** `drive_min_from_wilmore` and `revenue` each
had 444 currency-shaped cells and 0 `$`-signs, so the sort was a tie and
`Array.prototype.sort`'s stability handed it to whichever came first in the
header row — the drive-time column. A header exclusion list existed
(`AMOUNT_EXCLUDE_HDR`) but did not contain "min", and — see the census — its
`\b` anchors could not fire across underscores anyway.

### The rule now (`amountColumnEvidence` / `scanAmountShapedColumns`)

A column qualifies on **positive evidence only**:

- a currency symbol, a thousands separator, or a two-decimal fraction in ≥20% of
  non-empty values, **or**
- a money word in the header (`MONEY_WORDS`).

and is **disqualified regardless** when the header carries a measurement
qualifier (`MEASUREMENT_QUALIFIERS`). The values must still read as numbers
before a subtotal is claimed for the column, so a column headed "Amount" over
prose is not money either.

Measured on `steward-leads.csv`:

| Column | Verdict |
|---|---|
| `revenue` | qualifies — the header says "revenue" — **$386,923,121** |
| `expenses` | qualifies — **$357,018,765** |
| `contributions` | qualifies — **$93,358,920** |
| `deficit` | qualifies — **$18,736,986** |
| `contrib_lost_yoy` | qualifies (money word `contrib`) — **$14,032,461** |
| `drive_min_from_wilmore` | refused — *"min" makes this a measurement, not money* |
| `contrib_pct_of_revenue` | refused — *"pct"* |
| `contrib_change_pct` | refused — *"pct"* |
| `fiscal_year` | refused — *"year"* |
| `ein` | refused — *"ein"* |
| `zipcode` | refused — *"zipcode"* |

Every column the spec named passes or fails as the spec says.

### What the receipt says now

`scanAmountShapedColumns` returns **every** qualifying column with its own
subtotal and its own reason. `sum` is the strongest **single** column's
subtotal — never a cross-column collapse, because two money columns added
together are not a figure anyone can check — and `total` is the sum across all
of them, meaningful only next to the list.

The dollar equation anchors **only when there is no ambiguity about which
column the figure came from**: the column the import mapped as an amount, or the
one and only column that qualifies. Otherwise `dollars.inFile` is `null` and the
panel says, in a sentence:

> *5 columns in this file read as currency — "revenue" $386,923,121 · "expenses"
> $357,018,765 · "contributions" $93,358,920 · "deficit" $18,736,986 ·
> "contrib_lost_yoy" $14,032,461 — and none was mapped as a gift amount, so
> there is nothing to reconcile against.*

and with no qualifying column at all:

> *no unmapped column reads as currency either, so there is nothing to
> reconcile against.*

BUILD-79 Part 3.1's purpose is preserved: with no amount column mapped the
panel still refuses to print "Balanced · $0" — green is not earned, and the
reason is named.

### ⚠️ Where this lands against acceptance criterion 1 — READ THIS

Acceptance 1 says *"The receipt for `steward-leads.csv` names no dollars,
because that file has none."* **The receipt does name dollars on that file** —
five columns, each with its own subtotal.

This is a genuine tension inside the spec, and P0-1's body is the more specific
instruction, so it is the one followed:

- The spec itself says `revenue`, `contributions`, `deficit` and
  `contrib_lost_yoy` are the columns "holding the actual dollars" that "sat
  unscanned", and requires `contrib_lost_yoy` to pass the qualifier test. A rule
  that made this file name no dollars would have to refuse those columns, which
  contradicts the same section.
- The rule says: *"When more than one column qualifies, scan all of them and
  name each one in the receipt with its own subtotal. Never collapse to a single
  anonymous figure."*

What acceptance 1 is *protecting* — that no fabricated **gift** figure reaches
the screen and no balance is asserted from one — is fully delivered: the
equation is not anchored, no total is claimed, and the sentence says these are
unmapped columns rather than money that went missing. **If you want the stricter
reading (name the count, suppress the subtotals), it is one line in
`Donors.jsx`'s `curList`.** Flagged rather than decided silently.

### CENSUS — the measurement-versus-subject class

Every place that infers meaning from a column, header or values. The class was
fixed in `guessField` by the 9 Sep mapper FIX and left alive in the scanner;
that duplication is now gone — `MEASUREMENT_QUALIFIERS`, `normalizeHeader` and
`headerMatchesLabel` live once, in `shared/importShape.js`, and every caller
reads them.

| # | Path | Verdict |
|---|---|---|
| 1 | CSV `guessField` (`Donors.jsx`) | **FIXED at the seam.** Its private `_normHdr` / `_QUALIFIER_WORDS` / `_headerMatchesLabel` copies are deleted; it calls the shared `headerMatchesLabel`. This is why the two could disagree at all. |
| 2 | the value scanner `scanAmountShapedColumns` | **FIXED** — the whole of P0-1 above. |
| 3 | workbook header path `guessStandardField` / `buildStandardMapping` | **SAFE, and de-duplicated.** It was already whole-header (BUILD-82); its second private normaliser `normHdr` is now `normalizeHeader`, so "board (y/n)" normalises identically on both paths. |
| 4 | `autoDetectWideConfig` / `yearColToDate` (year columns) | **FIXED** — a boundary defect: see census 2, row 3. |
| 5 | cover-sheet legend read (`extractWorkbookLegend`, `buildSheetSignals`) | **SAFE.** It reads legend *cells* against colour keys and quotes the legend text back to the user for an explicit answer; it infers no field from a header. |
| 6 | shape detector `detectImportShape` | **SAFE.** It counts columns `guessField` recognised and reports its evidence; fixing #1 fixes its input. Its own tests are `hasAmountCol`/`hasDateCol` over the recognised set, not over header text. |
| 7 | date-convention inference (`inferDateConvention`) | **SAFE.** Reads VALUES only (impossible-month evidence), never a header. |
| 8 | `columnTypeEvidence` / `validateMappingChoice` | **SAFE.** Reads values, and refuses a mapping the values do not support — the backstop that catches a header the seam still gets wrong. |
| 9 | flag-column detection `detectFlagColumns` | **SAFE.** Anchored phrase patterns over the header, checked against the fixture family. |
| 10 | owner-column detection `detectOwnerColumn` | **SAFE.** Whole-header alias list. |
| 11 | `normalizeStage` (a stage CELL, not a header) | **FIXED** — same class one level down: `v.includes("ask")` read **"Alaska"** as *solicit*, `v.includes("lost")` read "Lost Creek Chapter" as *lapsed*, `v.includes("warm")` read "Warmack" as *qualify*. Now whole-token, with prefix families (`qualif`, `cultivat`) expressed as token prefixes and multi-word rules as token runs. |
| 12 | `NEGATOR_PHRASES` in `guessField` | **FIXED** — `h.includes("no mail")` refused "Casino Mailing List". Now a token run. |

---

## P0-2 — an organization name is not treated as a name

`resolveDonorIdentity` (`shared/importShape.js`) is the one function. A donor
record is nameable when it has **a person name, an email, or an organization**.

- organization present → **the organization is the donor**; a person on the same
  row is the **contact**, carried in `donors.contact_name`, never folded into
  the donor's name.
- person only → an individual (a name that still *reads* as an organisation —
  "Wilmore Rotary Club" in a name column — is still typed as one, BUILD-80 Part 7).
- email only → nameable; display name becomes "Unnamed donor (line N)" +
  `needs-name`, unchanged from before.
- none of the three → set aside, reason **`no name, email, or organization`**.

**Donor type.** No new column was needed: `donors.kind` (BUILD-80 Part 7)
already carries it and already gates every person surface (drift, re-engage,
attention, thank-you threads). It now takes three explicit values —
`person` | `organisation` | `anonymous` — and the import writes `person`
explicitly instead of leaving NULL, so "unset" and "a person" stop being the
same value. `donors.contact_name` is new. (`donors.donor_type` is unrelated: it
is BUILD-82's pass-through of the *source file's* own "Donor type" column.)

**Set-aside vocabulary.** `no name or email` → **`no name, email, or
organization`**, in one constant (`NAMEABILITY_REASON`), rendered by the
pre-write line, the completion receipt, and the `no_donor_identity` reason label
the downloadable set-aside file uses. Per the promise-field rule, all three read
the same string.

### CENSUS — every place that decides whether a row is importable

| # | Path | Verdict |
|---|---|---|
| 1 | CSV aggregate — `buildDonorRows` (`Donors.jsx`) | **FIXED** — calls `resolveDonorIdentity`. |
| 2 | CSV wide/year-column — `buildCombinedRows` (`Donors.jsx`) | **FIXED** — same call, same reason string. |
| 3 | CSV transaction / per-gift — `buildTransactionRows` (`shared/importShape.js`) | **FIXED** — it had an `orgName` column but folded it into the name with `rawName \|\| first+last \|\| orgName`, which **dropped the organization entirely whenever a contact person existed**. Now the same function decides, and the person becomes the contact. |
| 4 | workbook donor sheet — `buildWorkbookDonors` | **FIXED** — an `organization` standard field was added to `STANDARD_DONOR_FIELDS` and the builder routes through `resolveDonorIdentity`. |
| 5 | workbook gift-sheet orphans — `linkWorkbookGifts` | **SAFE, reworded on the same rule.** It refuses a gift row whose id matches nothing *and* which carries no identity of its own; identity now includes an organization by virtue of #3's shape. |
| 6 | server backstop — `POST /donors/import` (`no_usable_name`) | **DELIBERATELY LEFT name-only, with the line that reverses it.** By the time a payload reaches the server the organization has already *become* the name; this is a last-resort guard against a caller sending a blank name, not a second nameability policy. To make it the same test, it would need the raw organization field on the wire, which no client sends. |
| 7 | server backstop — `POST /donors/import-combined` (`namelessRows`) | **Same verdict, same reason.** |

---

## P0-3 — stage assignment asserts a basis it does not have

`stageAssignmentBasis(mapped)` (`shared/importShape.js`) declares the basis as a
**field list** (`STAGE_BASIS_FIELDS`) and derives the sentence from the entries
that are actually mapped. Nothing is hand-written, so a basis that cannot be
read back off the mapping cannot be claimed:

- amount and/or date mapped → *"Based on lifetime giving and last gift date."*,
  split kept.
- neither → *"No giving data in this file, so everyone starts in the same stage.
  Drag from the Kanban after import."* — **one stage** (`prospect`), no
  distribution, and the eyebrow reads "Starting stage" rather than "Smart Stage
  Assignment Preview".

`inferStage` is not called at all when there is no basis, which is what removes
the 159/40 split: it came from `inferStage`'s contact-info fallback, a
reachability rule, presented under a sentence claiming giving history.

### Two BUILD-83 contract leftovers this uncovered

BUILD-83 Part 3.5 made a stage a *decision*: everything inferred lands in
`suggested_stage` and `stage` stays NULL until a human places the donor. It was
applied to `POST /donors/import-combined` only. Two paths were still writing
`stage` directly:

- **`POST /donors/import`** — the donor-only path, which is *exactly* the path a
  gift-less file takes, i.e. the file whose stages are pure guesswork. **FIXED.**
- **`POST /gifts/import-history`** — wrote `stage` and gated on
  `stage = 'prospect'`. Fixing the first would have silently broken this one:
  with `stage` now NULL, the gate matched nothing and a donor whose gift history
  arrived later would have stayed a prospect forever. **FIXED in the same pass**
  — it writes `suggested_stage` and the guard is `stage IS NULL`, i.e. revise a
  suggestion, never a placement. (`tests/import-stage.test.js` caught this; it
  is the reason that suite is in the battery.)

---

## P0-4 — the Map geocoded on every render and stored nothing

### Root cause, confirmed

`DonorMap.jsx` ran `geocode()` inside a `useEffect` keyed on `[donors, myOnly]`,
one `fetch` per donor to `https://nominatim.openstreetmap.org/search`, 1,200 ms
apart, with results in `useState`. Nothing persisted; nothing survived a
navigation or a refresh. **It was the public Nominatim instance** — so this was
a terms problem as well as a performance one: that instance's policy caps bulk
geocoding at four requests a minute, requires results be cached caller-side, and
forbids systematic queries. At 444 donors that is ~9 minutes of crawl; a
25,000-donor org is not reachable at all. And it sent donor home addresses to a
third party on every page view.

### What replaced it

`geocode.js` — one seam, the way `assetStore.js` and `RESEND_BASE_URL` are
seams — plus a write-time job in `server.js`.

- **New donor columns:** `latitude`, `longitude`, `geocoded_at`,
  `geocode_status`, `geocode_provider`, `geocode_key`. Status ∈ `pending` |
  `ok` | `no_address` | `not_found` | `failed`; `pending` is the only
  non-terminal one.
- **Triggered by writes only:** import completion (both import routes),
  `PUT /donors/:id`, and `POST /donors/merge` (a merge fills the survivor's
  empty fields from the folded record — city/state/zip among them — so it can
  change an address). Never on a read. `POST /donors` carries no address
  fields, so there is nothing to mark.
- **Server-side, batched, background:** the existing 5-minute tick, budget
  `GEOCODE_TICK_BUDGET` (500/tick), and every run logs its cost the way the
  import logs its write round trips —
  `[geocode] provider=… rows=… distinct=… requests=… ok=… not_found=… failed=… …ms`.
- **Never looked up twice:** a record whose `geocode_key` still equals its
  address and whose status is `ok` is skipped in SQL, and the queue
  de-duplicates by key before spending a request — an org with 400 donors in one
  town is **one** lookup. That is the caching requirement satisfied by
  construction rather than by a cache anyone has to trust.
- **The map reads stored coordinates** and makes **zero** geocoder requests. Its
  only network call is `GET /geocode/status`, which returns counts and a
  provider *name*.
- **Degradation, which is the part that gets skipped:** the map always renders
  and says what it lacks, in the receipt's vocabulary —
  *"1,842 mapped · 116 no address on file · 12 could not be located · 30 still
  processing"* — and when nothing is placed it says so in a sentence instead of
  showing an empty grey rectangle with a spinner.
- **Provider:** `GEOCODIO_API_KEY` → Geocodio (US/CA, batched 1,000/request);
  `GEOCODE_NOMINATIM_BASE` → a self-hosted instance; neither → **not
  configured**, in which case the job does not run, **no address leaves the
  server**, and the map says so. The **public Nominatim instance is refused by
  hostname in code**, so the terms problem is not one env var away.
- Every request carries an identifying User-Agent naming Steward and a contact
  address.

`audit/data-handling.md` now names the provider table, exactly what is sent
(address fields only — never name, email, phone, giving history or record id),
and what is retained. **The production provider is Jonathan's call and is open
in `BLOCKED-build84.md`;** until it is made, production is in the "not
configured" state — correct and honest, but the map shows no pins.

### CENSUS — every surface that resolves an address at read time

| # | Surface | Verdict |
|---|---|---|
| 1 | Donors → Map (`DonorMap.jsx`) | **FIXED.** The one that was noticed, because it is visibly slow. |
| 2 | Donor profile / donor list | **SAFE.** Renders `city, state` as stored text; no lookup of any kind. |
| 3 | Tax receipts + year-end statements (`receipts`) | **SAFE.** Prints the stored address; never resolves it. |
| 4 | Donor portal + `/giving` directory | **SAFE.** No donor address is on any donor-facing surface; the directory's org rows carry a city string, unresolved. |
| 5 | Reports / exports (`/reports/:key`, export ZIP) | **SAFE.** Address columns are copied verbatim. |
| 6 | Distance / proximity sorting | **DOES NOT EXIST.** Grepped for it; there is no distance-sort, no radius filter and no reverse lookup anywhere in the product. If one is ever added it reads the stored coordinates. |
| 7 | AI context builders (`buildContext`) | **SAFE.** Sends giving summaries and names; no address, no geocoder. |

---

## CENSUS — bare substring matching over structured data

The rule now lives once, in **`shared/textMatch.js`**, whose header carries the
whole history of the class. `tokenizeText` / `containsTokenRun` /
`eitherContainsTokenRun` for text; `findLeaf` / `numericLeafEquals` /
`textLeafContains` for payloads.

### Method

`.includes(` / `.indexOf(` / `.search(` / `.match(` across `server.js`,
`shared/`, `client/src/**`, `routes/`, `scripts/` and `tests/`: **279 call
sites**, classified —

- **53 array-literal + 36 named-array** `.includes()` — membership tests on an
  array (`["a","b"].includes(x)`, `IMPORT_STAGES.includes(v)`,
  `f.aliases.includes(h)`, `tokenSubset`'s `long.includes(t)`). **Not substring
  tests at all**; boundaries are the array elements. **SAFE as a class.**
- **52 regex** `.match(` / `.search(` — reviewed individually; all anchored
  (`^…$`), `\b`-bounded, or deliberate free-text extraction over a note.
  **One boundary defect found** — row 3 below.
- **138 string `.includes(` / `.indexOf(`** — triaged below.

### The hits, with verdicts

| # | Call site | Verdict |
|---|---|---|
| 1 | `server.js` — thank-you queue: `g.donor_name.includes(x.name) \|\| x.name.includes(g.donor_name)` | **FIXED** → `eitherContainsTokenRun`. "Ann Lee" is a letter-substring of "Joann Leewood", so a confirm-this-amount flag could land on the wrong donor's thank-you. |
| 2 | `Donors.jsx` — `matchDonorForGift` partial: `dn.includes(norm) \|\| norm.includes(dn)` | **FIXED** → `eitherContainsTokenRun`. Same pair, offered as *the donor for a gift*. |
| 3 | `Donors.jsx` — `yearColToDate`: `/\b(20\d{2}\|19\d{2})\b/` and `/fy[\s_-]?(\d{2,4})\b/i` over a raw header | **FIXED** — the underscore defect. `\b` does **not** fire at `_` (it is a word character), so `fund_2023` and `fy2024_total` matched *nothing* — while `YEAR_HDR_PAT`, which is unanchored, called both year columns. Two rules, one header, opposite answers. The header is normalised to tokens first. |
| 4 | `shared/importShape.js` — `AMOUNT_EXCLUDE_HDR` `\b(zip\|…\|year\|…)\b` | **DELETED with the scanner rewrite.** Same underscore defect: it is why `fiscal_year` and `zipcode` slipped through on the real file. |
| 5 | `client/src/lib/campaignMatch.js` — `b.includes(a) \|\| a.includes(b)` at 0.90 confidence | **FIXED** → `eitherContainsTokenRun`. It scored "Gala" against "Galaxy Fund" at 0.90 and offered a one-tap attribution. |
| 6 | `Donors.jsx` — `normalizeStage` | **FIXED** (see P0-1 census #11). |
| 7 | `Donors.jsx` — `NEGATOR_PHRASES.some(n => h.includes(n))` | **FIXED** (see P0-1 census #12). |
| 8 | `tests/portal-page.test.js` — the donor-leak guard | **ALREADY FIXED at `1550cf0`** (the commit that prompted this census). Re-verified: it walks the payload, types the comparison, and proves it can fire. |
| 9 | `tests/{custom-fields, campaign-impact, digests, network-gate, org-blindness, network-directory, portal-page, recurring-surface, reserved-recovered, theme-assets}` — 16 `JSON.stringify(payload).includes/match` guards | **ALL FIXED.** They now walk the payload through `tests/helpers.js`'s `leaks()` / `textMatch()`, which are the CommonJS door onto `shared/textMatch.js` — one definition, not a copy. Figures compare as **numbers**, names as **token runs**, and opaque markers (`;base64,`, `youtube.com/watch`) as raw needles inside *string leaves* — which is the part the walk, not the needle, makes safe. |
| 10 | `scripts/seed-build54-demo.js` — `JSON.stringify(gifts).includes("build54 demo gift")` | **FIXED.** The idempotency check reads the `notes` field it wrote. |
| 11 | `tests/import-messy-v2.test.js:164` — `trapRaws.includes(t)` | **SAFE.** `trapRaws` is an array; the `JSON.stringify` on that line is in the assertion's *label*. |
| 12 | Search boxes — donor/campaign/transaction/org/fundraiser filters, `TopBar` ⌘K, `AdminDashboard` | **SAFE, DELIBERATELY substring.** A user-typed search box is a substring search *by design*: someone typing "har" expects "Harmon". The haystack has boundaries; ignoring them is the feature. Written down here once for the whole class rather than at ~25 call sites. |
| 13 | Free-text note markers — `note.includes("answered: yes")`, `detectNoteMarkers`, `parseAttributionNote` | **SAFE.** The haystack is genuinely unstructured prose and each needle carries its own punctuation or a `\b`. |
| 14 | `email.includes("@")`, `token.includes(".")`, `mimeType.includes("mp4")`, `url.includes("/portal-assets/")`, `raw.includes("$")` | **SAFE.** Single-character or delimiter-shaped probes on a format that defines that character as its separator. |
| 15 | `shared/importShape.js` — `tokenSubset`'s `long.includes(t)` | **SAFE, and the right pattern**: `long` is an array of tokens. This is what every fix above converges on. |

**No `JSON.stringify`-then-search survives.** `tests/build84.test.js` §4 walks
`server.js`, `db.js`, `geocode.js`, `shared/`, `client/src/`, `tests/`,
`scripts/` and `routes/` for the pattern and fails the build if one reappears.

---

## FEATURE — a task with a time on it emails at that time

### The prerequisite, established first

**The due field held no time before this build.** `threads.due_date` is
`TEXT NOT NULL` carrying a civil `YYYY-MM-DD`, and every BUILD-81 default is
`+N days`. There was no 2:00 to fire at.

**What was migrated: nothing, by construction.** The time rides *beside* the
date as a nullable `threads.due_time TEXT` (`HH:MM` in the org's zone) rather
than converting `due_date` to a `timestamptz`. A civil date is a day on a
calendar in every timezone on earth (`orgTime.js`'s type discipline); dragging
every existing date-only task through a zone it never had would be the larger
change and the wrong one. Every pre-existing row is date-only and stays
date-only. Setting a time is optional, and a user who never sets one sees no
change anywhere.

### Precedence — one rule, one function

`digestShouldSkip` and `stepReminderDue` (`shared/threadShape.js`) are read by
**both** the digest and the timed sender, so the two cannot disagree:

- a task **with a time** sends its own email at that time and is excluded from
  the morning digest **on its due date only**;
- a task with a date and **no time** stays in the digest exactly as before and
  sends nothing of its own;
- a timed task left open **rejoins the digest the next morning as overdue**,
  counted like everything else.

Pinned end to end in `tests/build84.test.js` §6/§7: the timed task is absent
from that morning's digest, present the next morning as overdue, and the timed
sender never fires for it twice.

### The rest of it

- **Delivery window:** 90 minutes. A 2:00 reminder delivered at 5:00 has lost
  the only thing that made it worth sending.
- **Weekends invert:** the timed sender has **no weekday gate** —
  `threadNudgeDayOk` is the digest's alone. Said next to the weekend toggle in
  Settings so it is not a surprise.
- **The button** goes to the donor's **log-one-line screen prefilled with the
  task** (`?conversation=1&step=…`), not the plain profile. It is a plain
  navigation: BUILD-81's rule stands, mail clients prefetch links, a `GET` must
  never change state. Done and Snooze happen on the page as `POST`s.
- **Timezone:** `orgs.timezone` has always been `NOT NULL` with an
  `America/New_York` **default**, so "has a timezone" was trivially true for
  every org and meant nothing. `orgs.timezone_confirmed_at` records a timezone a
  **human chose**. Without it the time field is not offered, the route refuses
  the time with `timezone_unset`, and the form says why. Onboarding now asks —
  prefilled from the browser's zone, shown, confirmed by continuing.
- **Off switch:** `users.notify_step_reminder`, per-user, default on, in the
  **same** Email-notifications list as the nudge. Not a second settings screen.
- **Recipient:** the thread's owner, else its creator, else the org. A time is
  one person's commitment, not the org's.
- **Idempotency:** `digest_sends` keyed `step_reminder` / `step:<threadId>:<day>`
  — one email per thread per user per day, the mechanism the nudge already uses.

---

## The verification walk — the real file, the real UI

`scripts/build84-capture.js` (**38 assertions, ALL GREEN**) is the hour that
found all four defects, made repeatable: a fresh org, `steward-leads.csv`
dropped into the real import UI at 1440, then the Map, then a timed step.
Screens and the full page text in `docs/build84/`.

| Measured | |
|---|---|
| click → receipt | **42.4 s** (444 rows, 30 columns) |
| rows ready before the write | **444 of 444**, none unnameable |
| donors written | **444** — 444 typed `organisation`, **199** carrying a contact person |
| gifts written | **0** — nothing invented from a currency-shaped column |
| stages placed | **0**; suggestions all one stage |
| geocoder requests made by the Map | **0**, on first load, after a refresh, and after navigating back |
| the write-time job, with a provider | **444 donors resolved in ONE batched request, 28 ms** — 408 distinct addresses, because the queue de-duplicates by address before spending anything |
| a re-run of the job | **0 provider requests** — no address changed, so nothing is looked up twice |
| Map → 444 pins from stored coordinates | **2.0 s**, including the whole SPA load |

The receipt on that file, verbatim:

> **WHAT'S MISSING BEFORE THIS COUNTS AS FULLY ACCOUNTED FOR**
> · no amount column was mapped
> · no gift-date column was mapped
> · 5 columns in this file read as currency — "revenue" $386,923,121 ·
>   "expenses" $357,018,765 · "contributions" $93,358,920 · "deficit"
>   $18,736,986 · "contrib_lost_yoy" $14,032,461 — and none was mapped as a gift
>   amount, so there is nothing to reconcile against
> · so the dollar equation has no left-hand side to check — that is why it does
>   not balance, not a lost figure
>
> **In your file** 444 · unknown — no column is mapped as the gift amount

and the stage panel:

> **STARTING STAGE** — prospect × 444
> *No giving data in this file, so everyone starts in the same stage. Drag from
> the Kanban after import.*

### What only the walk caught

**A `const` referenced before its declaration, swallowed by a `catch`.** The
new `stageBasis` memo was inserted between `payload` and `stagePreview`, so
`payload`'s factory read it in its temporal dead zone. `payload`'s
`catch (e) { … return { donors: [], … } }` turned a `ReferenceError` into
**"No rows ready — map at least one column to name or email"** — a sentence
that reads like a mapping problem. Every unit test still passed, because the
pure builders were correct; only rendering the component in a browser could
show it. The walk now fails on any `[import]` console error rather than only on
an uncaught `pageerror`, so this shape cannot pass silently again.

**Two wordings that were false the moment the scanner got smarter.** The
arithmetic panel said *"unknown — no amount-shaped column found"* on a file
where five were found and none was mapped; and the missing-list printed the
currency list twice, reading as two findings where there is one. Both fixed and
pinned in the walk.

---

## Acceptance

| # | Criterion | Status |
|---|---|---|
| 1 | receipt for `steward-leads.csv` names no dollars, in a sentence | **PARTIAL — flagged above.** No gift figure, no anchored equation, and a sentence rather than an omission; but the five currency columns *are* named with their subtotals, because P0-1's own rule requires it. One line to change if you want the stricter reading. |
| 2 | 444 of 444 import, organizations as donors, contacts attached | **DONE** — 0 of 444 rows are unnameable; the fixture pins the shape per name. |
| 3 | stage assignment puts everyone in one stage and says why | **DONE** |
| 4 | build82/build83 fixtures unchanged; v3 reads back $51,754,243.82 | **DONE** — `import-workbook-v3` 147/147, `import-messy-v2` 185/185, `import-messy-cf` 111/111, all unchanged |
| 5 | the findings state both censuses, path by path, with verdicts | **DONE** — above |
| 6 | `35/35` stays green | **DONE** — `tests/network-gate.test.js` 35/35 |
| 7 | the Map renders from stored coordinates, no geocoder request on load | **DONE** — **measured**: every outbound request the page made was recorded; zero reached a geocoder on first load, after a refresh, and after navigating back. 444 pins in 2.0 s. |
| 8 | every donor leaves an import with a terminal `geocode_status`, counts add up | **DONE** |
| 9 | `data-handling.md` names the provider, what is sent, what is retained | **DONE**, with the production provider open in `BLOCKED-build84.md` |
| 10 | the substring census is stated call site by call site; no stringify-then-search survives | **DONE**, and guarded |
| 11 | whether the task due field held a time, and what was migrated | **DONE** — it did not; nothing needed migrating, by construction |
| 12 | no task reported by both surfaces on the same day | **DONE** |

## Out of scope, as stated

Unifying the per-shape column vocabularies (still a data-contract change of its
own). The Finance tab decision, still open in `BLOCKED-build83.md`.
