# FIX-2 E — the carry-overs, and no ISO date on any screen

Branch `fix-2-e`, cut from `fix-2` at `58c61bc`. Stack: API :5851, preview :4451,
database `steward_fix2_e`.

## Finding 9 — "last grant" on churches and businesses

**What was found.** Exactly one surface in the product says "last grant": Home's
institutional list (`client/src/components/Dashboard.jsx`, which renders the
`lastWord` that `/drift` computes in `routes/crm.js` with
`shared/institutional.js` `lastGiftWord`). I grepped `client/src`, `routes`,
`shared`, `server.js` and the root modules for the phrase, for any `? "grant" :
"gift"` choice, and for grant wording in the donor directory, the profile, the
funder panel, Drift, reports and PDFs. Nothing else says it. The funder panel
reads "As a funder / Grants with them", and it never labels a last gift.

**Why Jonathan saw it.** Those three names are not in `scripts/seed-demo.js`.
They come from the BUILD-89 demo file (`scripts/build89-demo-seed.js`, whose
`CHURCH_A`/`BIZ_A` tables make "Hope Presbyterian Church", "Ironworks Coffee
Roasters" and "Rivet Bakery"), imported into Harborlight through
`/donors/import-combined` with `donorType` church/business and no funder type.
I imported organisations shaped exactly like that into a fixture org on this
branch, and `/drift` returns "last gift" for all three, with "last grant" for a
foundation and a DAF. The rule (`8ffa957`, FIX-1) was already right. The walk
most likely ran on a build from before `8ffa957`: FIX-1 added the rule on
27 September, the day of the walk.

**The seed's data is not wrong.** The seed writes those three with donor_type
church/business and no funder_type, and the rule reads that as "gift". I did
not change the seed.

**Guard:** `tests/fix2-e-grant-word.test.js` (CORE).
- §1: "last grant" is written only in `shared/institutional.js`. No other file
  chooses between grant and gift by itself, and the server fills every row's
  word from `lastGiftWord`.
- §2: `/drift` on the organisations imported through the demo file's route.
- §3: Home at 1440 and 390, one row per organisation, plus a check that the
  row dates are not ISO.

It was green on its first run because the defect was already fixed, so there
is no honest red commit for this finding. Planted-defect proof
(`audit/fix2-e-grant-word-planted.txt`): I made `lastGiftWord` always return
"last grant" and added a `? "grant" : "gift"` line to a client file. §1, §2 and
§3 went red (10 failures). I reverted both.

## Finding 10 — no ISO date on any screen

Every date a person reads now goes through `shared/displayDate.js`. The sites
fixed are `Dashboard.jsx` (Home thread rows), `DonorProfile.jsx` (open steps,
soft credits, the pledge option, the gift table, pledges, funds, interactions,
milestones), `shared.jsx` (touchpoint timeline and chart tooltip),
`Fundraising.jsx`, `Finance.jsx` (transactions, plus its local `fmtDate`),
`RecurringGiving.jsx` (its local `fmtDate`), `Events.jsx` (its local `fmtDate`),
`EventsDesk.jsx`, `Memberships.jsx`, `RestrictedView.jsx`, `Settings.jsx`,
`VolunteersHub.jsx`, `VolunteerPanel.jsx`, `DonorImport.jsx`,
`WorkbookImport.jsx`, `LogConversation.jsx`, `DonorPortalHub.jsx`,
`PortalWidgets.jsx`, `pages/Donate.jsx` and `pages/AdminDashboard.jsx`. The
three local `fmtDate` copies went through `new Date(iso)`, which moves a civil
date by a day west of UTC. They now call the one formatter. Import-preview
cells use `displayDate(x) || x`, so a raw file value that isn't a date still
shows as it was typed. Anything the formatter reads is never ISO.

**Guard:** `tests/fix2-e-no-iso.test.js` (CORE).
- §1 source (runs in CI, no browser): an espree walk of every JSX text child in
  `client/src`. It flags `String(x).slice(0,10)`, `.toISOString()`, and a raw
  `*.date` / `due` / `*_date` / `*Date` / `*_at` / `*At` / `*_on` / `*On` field,
  whether printed directly, after `&&` / `?:`, or inside a template literal.
  Attributes (an `<input value>` keeps ISO) and block-bodied functions (logic,
  not text) are skipped. It is not noisy: one survivor is allowlisted with a
  reason (`pages/Landing.jsx`, whose sample card prints fixed labels like
  "Mar 3"). The survivors list must be exact.
- §2 browser: a fixture org `org_fx2eiso` gets the BUILD-89 demo file's shape,
  loaded by running `scripts/build89-demo-seed.js` as the fixture's own login
  through the API, plus two tasks. The walk runs at 1440 over every rail
  screen, every `[role=tab]` two levels down, five reports' results, and two
  donor profiles with all six tabs. It collects visible text nodes, excluding
  `select`/`option`/`textarea`/input values and `[data-export-preview]`, and
  fails naming the screen and the text around any `\d{4}-\d{2}-\d{2}`.
- Red run (`audit/fix2-e-no-iso-red.txt`): 890 ISO dates across Home,
  Dashboards, Fundraising, Finance, Reports and the donor profile.
- Planted-defect proof after the fixes (`audit/fix2-e-no-iso-planted.txt`): I
  put Finance's transaction cell back to `{t.date}`. §1 names
  `Finance.jsx:1066` and §2 names "Finance › Transactions … 2026-09-27". I
  reverted it.

**What the guard still finds on this branch.** These are expected until the
merge: they sit in files owned by other workstreams, and I did not edit them.
- **A, `Dashboards.jsx`:** "As of 2026-09-27" on the board.
- **B, `Reports.jsx` / `ReportBuilder.jsx`:**
  - "Your reports": a saved report's result table prints ISO last-gift dates
    (336 occurrences).
  - "Gifts for the bookkeeper": the gift table prints ISO dates (476).
  - "Week in Review": "2026-09-14 to 2026-09-20" (2).
  - `Reports.jsx:470` renders `t.dueDate` raw inside a `render=` attribute,
    which the source leg cannot see and the browser leg does.

If B decides the bookkeeper table is an export preview, marking its container
`data-export-preview` excludes it.

## Finding 11 — the donor profile's "day 0", stale contact and Lapsed pill

- An open step opened today reads "opened today", and "day N" from day 1 on
  (`DonorProfile.jsx`). The same line's due date and last-touch date now read
  "Sep 30" rather than ISO.
- A stale last contact is brass: `moveUrgency`'s `critical` colour moved from
  `T.terracotta` to `T.gold700` (`shared.jsx`). Its only reader is the
  profile's Contact tile.
- Lapsed is brass everywhere on the profile. `stageTone()` in
  `DonorProfile.jsx` covers the header pill (`T.gold700` on `T.gold100`), the
  right rail's stage picker and its hint rule (`T.gold` on ink), and the edit
  form's stage picker. `STAGES.lapsed.color` in `shared.jsx` is still
  `T.terracotta` for every other screen (Pipeline and elsewhere). That is C's
  app-wide colour call, and this branch does not change it.

**Guard:** `tests/fix2-e-profile.test.js` (CORE). §1 checks the source; §2 runs
the browser at 1440 and 390 on fixture `org_fx2eprof` and checks computed
colours against terracotta `rgb(184, 89, 63)`. Red 13/20 before the fix
(`audit/fix2-e-profile-red.txt`). After the header-pill fix, I added an
assertion for the stage picker. It went red (2 failures) against a dist built
before the picker change, which proves it can fail. It is now green at 22/0.

**Left for C (the overdue-is-brass rule, outside finding 11's three items):**
an overdue open step's text and its card border on the profile are still
`T.terracotta`. The Contact tile also reads "0d ago" for a donor contacted
today. That is not "day 0", but a later pass could say "today".

## Part E

(a) **The volunteer sign-up link is revocable.** `fix1-volunteers` returned
54 passed, 0 failed, the same as the baseline; its §9 covers revocation. It
holds, so I changed nothing.

(b) **Lint.** `eslint-plugin-react` is not a dependency, so
`client/eslint.config.js` defines the equivalent of its `jsx-uses-vars` inline:
a JSX tag, or the root of `<Foo.Bar/>`, marks its variable used. That adds no
new dependency. I removed FIX-1 C's file-wide `/* eslint-disable
no-unused-vars */` from `VolunteersHub.jsx`, and that file lints clean without
it. The warning count went from **562 to 106**, with 0 errors before and after.
No real errors surfaced.

## Run results (my stack, fresh database)

- **Run 1:** the 50 CORE suites that read a changed file or walk
  `client/src`, plus my three. 50 passed, 2 failed:
  - fix2-e-no-iso: A/B's dates, expected until the merge.
  - fix2-e-profile: the new stage-picker assertion against a stale dist.

  build89s-surfaces showed 67 → 57 with one SKIP because build89s-sources had
  not run first. Run 2 includes it.
- **Run 2:** after the picker fix, rebuilt from a fresh database. 22 passed,
  1 failed (fix2-e-no-iso, A/B only), no SKIP lines.
  - build89s-surfaces 67 (baseline 67).
  - fix1-volunteers 54 (54).
  - build97-numbers 64 (64).
  - palette-census 13 (13).
  - fix2-e-profile 22/0, fix2-e-grant-word 21/0.
- **PASS counts:** every other suite I ran matches the baseline exactly.
- **tdz-scan** on `client/src`: 0 self-references.
- **Lint:** 0 errors, 106 warnings.

## For the lead at merge

- CORE gains `fix2-e-grant-word`, `fix2-e-no-iso` and `fix2-e-profile`,
  appended after `fix2-codeql`.
- `fix2-e-no-iso` goes green only once A (`Dashboards.jsx` as-of) and B (report
  results, the bookkeeper table, Week in Review, `Reports.jsx:470`) have
  converted their dates. It seeds a 1,000-donor fixture org and takes about
  70s.
- `shared.jsx` and `DonorProfile.jsx` are also C's (colours). My edits there
  are the date formatter, `moveUrgency`'s `critical` colour, and the
  profile-local `stageTone`.
